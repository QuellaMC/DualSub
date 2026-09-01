import { describe, expect, test } from '@jest/globals';
import {
    extractDisneyPlusVideoIdFromPathname,
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromPathname,
    extractNetflixVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
    normalizeNetflixVideoId,
    readCustomEventDetail,
    readOwnDataProperty,
    readOwnPrimitiveDataProperty,
} from './subtitleRequestIdentity.js';

const MAX_SUBTITLE_ROUTE_ID_BYTES = 256;

describe('serialized event field reads', () => {
    test.each([
        {
            label: 'reads native CustomEvent detail',
            read: () => {
                const detail = { type: 'SUBTITLE_DATA_FOUND' };
                return readCustomEventDetail(
                    new CustomEvent('subtitle', { detail })
                );
            },
            expected: { type: 'SUBTITLE_DATA_FOUND' },
        },
        {
            label: 'reads an own data field',
            read: () => readOwnDataProperty({ own: 'value' }, 'own'),
            expected: 'value',
        },
        {
            label: 'ignores an inherited field',
            read: () =>
                readOwnDataProperty(
                    Object.create({ inherited: 'value' }),
                    'inherited'
                ),
            expected: undefined,
        },
        {
            label: 'accepts a string primitive',
            read: () => readOwnPrimitiveDataProperty({ value: '123' }, 'value'),
            expected: '123',
        },
        {
            label: 'accepts a numeric primitive',
            read: () => readOwnPrimitiveDataProperty({ value: 123 }, 'value'),
            expected: 123,
        },
        {
            label: 'accepts boolean and null primitives',
            read: () => [
                readOwnPrimitiveDataProperty({ value: false }, 'value'),
                readOwnPrimitiveDataProperty({ value: null }, 'value'),
            ],
            expected: [false, null],
        },
        {
            label: 'rejects an object where a primitive is required',
            read: () => readOwnPrimitiveDataProperty({ value: {} }, 'value'),
            expected: undefined,
        },
    ])('$label', ({ read, expected }) => {
        expect(read()).toEqual(expected);
    });
});

describe('Disney+ canonical route identity', () => {
    test.each([
        {
            label: 'root video route',
            eventId: 'opaque-id',
            pathname: '/video/opaque-id',
            url: 'https://www.disneyplus.com/video/opaque-id?lang=en',
            expected: 'opaque-id',
        },
        {
            label: 'localized play route with encoded text',
            eventId: 'opaque%20id',
            pathname: '/en-gb/play/opaque%20id/',
            url: 'https://www.disneyplus.com/en-gb/play/opaque%20id/',
            expected: 'opaque id',
        },
        {
            label: 'literal percent route id',
            eventId: 'price%25off',
            pathname: '/browse/video/price%25off',
            url: 'https://www.disneyplus.com/browse/video/price%25off',
            expected: 'price%off',
        },
        {
            label: 'exact UTF-8 route id limit',
            eventId: 'é'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES / 2),
            pathname: `/video/${'é'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES / 2)}`,
            expected: 'é'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES / 2),
        },
    ])('$label', ({ eventId, pathname, url, expected }) => {
        expect(normalizeDisneyPlusVideoId(eventId)).toBe(expected);
        expect(extractDisneyPlusVideoIdFromPathname(pathname)).toBe(expected);
        if (url) expect(extractDisneyPlusVideoIdFromUrl(url)).toBe(expected);
    });

    test.each([
        ['extra route segment', null, '/video/opaque-id/extra'],
        ['non-player route', null, '/browse/opaque-id'],
        ['encoded slash', null, '/video/a%2Fb'],
        ['malformed escape', '%E0%A4%A', '/video/%E0%A4%A'],
        ['residual escape', 'a%252Fb', '/video/a%252Fb'],
        ['blank id', '%20%20', '/video/%20%20'],
        [
            'fallback marker',
            'unknown_video_fallback',
            '/video/unknown_video_fallback',
        ],
        [
            'over-limit id',
            'a'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1),
            `/video/${'a'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1)}`,
        ],
    ])('rejects %s', (_label, eventId, pathname) => {
        if (eventId !== null) {
            expect(normalizeDisneyPlusVideoId(eventId)).toBeNull();
        }
        expect(extractDisneyPlusVideoIdFromPathname(pathname)).toBeNull();
    });

    test('detects a stale event id against the current route', () => {
        const eventId = normalizeDisneyPlusVideoId('episode-old');
        const routeId = extractDisneyPlusVideoIdFromPathname(
            '/video/episode-current'
        );

        expect(eventId).toBe('episode-old');
        expect(routeId).toBe('episode-current');
        expect(eventId).not.toBe(routeId);
    });
});

describe('Netflix canonical route identity', () => {
    test.each([
        {
            label: 'numeric event id and exact watch route',
            eventId: 123456,
            pathname: '/watch/123456',
            url: 'https://www.netflix.com/watch/123456?trackId=1',
            expected: '123456',
        },
        {
            label: 'string id with canonical leading zeroes',
            eventId: '00123',
            pathname: '/watch/00123/',
            url: 'https://www.netflix.com/watch/00123/',
            expected: '00123',
        },
        {
            label: 'exact route id limit',
            eventId: '1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES),
            pathname: `/watch/${'1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES)}`,
            expected: '1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES),
        },
    ])('$label', ({ eventId, pathname, url, expected }) => {
        expect(normalizeNetflixVideoId(eventId)).toBe(expected);
        expect(extractNetflixVideoIdFromPathname(pathname)).toBe(expected);
        if (url) expect(extractNetflixVideoIdFromUrl(url)).toBe(expected);
    });

    test.each([
        ['localized watch route', null, '/en/watch/123456'],
        ['extra route segment', null, '/watch/123456/extra'],
        ['nonnumeric route id', '123x', '/watch/123x'],
        ['encoded numeric route id', null, '/watch/%31%32%33'],
        ['negative numeric id', -1, '/watch/-1'],
        ['non-integer numeric id', 1.5, '/watch/1.5'],
        [
            'over-limit id',
            '1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1),
            `/watch/${'1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1)}`,
        ],
    ])('rejects %s', (_label, eventId, pathname) => {
        if (eventId !== null) {
            expect(normalizeNetflixVideoId(eventId)).toBeNull();
        }
        expect(extractNetflixVideoIdFromPathname(pathname)).toBeNull();
    });

    test('detects a stale event id against the current route', () => {
        const eventId = normalizeNetflixVideoId(111111);
        const routeId = extractNetflixVideoIdFromPathname('/watch/222222');

        expect(eventId).toBe('111111');
        expect(routeId).toBe('222222');
        expect(eventId).not.toBe(routeId);
    });
});
