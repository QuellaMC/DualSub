import { describe, expect, it } from 'vitest';
import { platformFromHostname, platformFromUrl } from './platforms';

describe('platformFromHostname', () => {
    it.each([
        ['www.netflix.com', 'netflix'],
        ['netflix.com', 'netflix'],
        ['www.disneyplus.com', 'disneyplus'],
        ['www.youtube.com', 'youtube'],
    ])('places %s on %s', (hostname, platform) => {
        expect(platformFromHostname(hostname)).toBe(platform);
    });

    it.each([
        'youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'www.youtube-nocookie.com',
        'evilnetflix.com',
        'www.youtube.com.example',
    ])('places %s on no site', (hostname) => {
        expect(platformFromHostname(hostname)).toBeNull();
    });
});

describe('platformFromUrl', () => {
    it('reads https URLs only', () => {
        expect(platformFromUrl('https://www.youtube.com/watch?v=x')).toBe(
            'youtube'
        );
        expect(platformFromUrl('http://www.youtube.com/')).toBeNull();
        expect(platformFromUrl(undefined)).toBeNull();
        expect(platformFromUrl('not a url')).toBeNull();
    });
});
