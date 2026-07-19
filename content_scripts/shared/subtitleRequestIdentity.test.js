import { jest } from '@jest/globals';

import {
    extractDisneyPlusVideoIdFromPathname,
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromPathname,
    extractNetflixVideoIdFromUrl,
    MAX_SUBTITLE_ROUTE_ID_BYTES,
    normalizeDisneyPlusVideoId,
    normalizeNetflixVideoId,
    readCustomEventDetail,
    readOwnDataProperty,
    readOwnPrimitiveDataProperty,
} from './subtitleRequestIdentity.js';

describe('subtitle request identity', () => {
    describe('descriptor-safe event field reads', () => {
        test('reads native and internal event details without invoking an own accessor', () => {
            const detail = { type: 'SUBTITLE_DATA_FOUND' };
            expect(
                readCustomEventDetail(new CustomEvent('subtitle', { detail }))
            ).toBe(detail);
            expect(readCustomEventDetail({ detail })).toBe(detail);

            const getter = jest.fn(() => detail);
            const hostileEvent = {};
            Object.defineProperty(hostileEvent, 'detail', { get: getter });

            expect(readCustomEventDetail(hostileEvent)).toBeUndefined();
            expect(getter).not.toHaveBeenCalled();
        });

        test('reads own data properties without accepting inherited fields', () => {
            const value = Object.create({ inherited: 'page-value' });
            value.own = 'isolated-value';

            expect(readOwnDataProperty(value, 'own')).toBe('isolated-value');
            expect(readOwnDataProperty(value, 'inherited')).toBeUndefined();
        });

        test('does not invoke accessors while reading primitive fields', () => {
            const getter = jest.fn(() => 'SUBTITLE_DATA_FOUND');
            const value = {};
            Object.defineProperty(value, 'type', { get: getter });

            expect(readOwnPrimitiveDataProperty(value, 'type')).toBeUndefined();
            expect(getter).not.toHaveBeenCalled();
        });

        test('accepts only primitive own data-property values', () => {
            const value = {
                text: '123',
                numeric: 123,
                boolean: false,
                empty: null,
                object: {},
            };

            expect(readOwnPrimitiveDataProperty(value, 'text')).toBe('123');
            expect(readOwnPrimitiveDataProperty(value, 'numeric')).toBe(123);
            expect(readOwnPrimitiveDataProperty(value, 'boolean')).toBe(false);
            expect(readOwnPrimitiveDataProperty(value, 'empty')).toBeNull();
            expect(
                readOwnPrimitiveDataProperty(value, 'object')
            ).toBeUndefined();
        });

        test('fails closed when a descriptor trap throws', () => {
            const hostile = new Proxy(
                {},
                {
                    getOwnPropertyDescriptor() {
                        throw new Error('page trap');
                    },
                }
            );

            expect(readOwnDataProperty(hostile, 'type')).toBeUndefined();
            expect(
                readOwnPrimitiveDataProperty(hostile, 'type')
            ).toBeUndefined();
        });
    });

    describe('Disney+ canonical route identity', () => {
        test.each([
            ['/video/opaque-id', 'opaque-id'],
            ['/en-gb/video/opaque-id', 'opaque-id'],
            ['/fr-fr/browse/play/opaque%20id/', 'opaque id'],
            ['/prefix/with/many/segments/video/price%25off', 'price%off'],
            ['/video/trailing%25/', 'trailing%'],
            ['/play/value%252G', 'value%2G'],
        ])('accepts terminal player pathname %s', (pathname, expected) => {
            expect(extractDisneyPlusVideoIdFromPathname(pathname)).toBe(
                expected
            );
        });

        test('accepts exactly the provisional 256 UTF-8-byte cap', () => {
            const videoId = 'é'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES / 2);

            expect(normalizeDisneyPlusVideoId(videoId)).toBe(videoId);
        });

        test.each([
            '/en-gb/video/opaque-id/extra',
            '/en-gb/video/opaque-id/extra/',
            '/en-gb/video/a/b',
            '/en-gb/video/',
            '/en-gb/browse/opaque-id',
            '/en-gb/video/%E0%A4%A',
            '/en-gb/video/a%2Fb',
            '/en-gb/video/a%2fb',
            '/en-gb/video/a%5Cb',
            '/en-gb/video/%00id',
            '/en-gb/video/id%0A',
            '/en-gb/video/id%7F',
            '/en-gb/video/id%C2%80',
            '/en-gb/video/%20%20',
            '/en-gb/video/unknown_video_fallback',
            '/en-gb/video/unknown%5Fvideo%5Ffallback',
        ])('rejects noncanonical pathname %s', (pathname) => {
            expect(extractDisneyPlusVideoIdFromPathname(pathname)).toBeNull();
        });

        test.each([
            'a%252Fb',
            'a%252fb',
            'a%255Cb',
            'a%255cb',
            '%252e%252e',
            '%252E%252e',
            'id%2500',
            'id%257F',
            'id%25c2%2580',
            'prefix%252Fsuffix',
            'prefix%255Csuffix',
            'prefix%252e%252e-suffix',
            'ordinary%2541escape',
        ])(
            'rejects residual percent escape %s for event and route normalization',
            (encodedVideoId) => {
                const eventVideoId = normalizeDisneyPlusVideoId(encodedVideoId);
                const routeVideoId = extractDisneyPlusVideoIdFromPathname(
                    `/en-gb/video/${encodedVideoId}`
                );

                expect({ eventVideoId, routeVideoId }).toEqual({
                    eventVideoId: null,
                    routeVideoId: null,
                });
            }
        );

        test.each([
            ['price%25off', 'price%off'],
            ['trailing%25', 'trailing%'],
            ['value%252G', 'value%2G'],
        ])(
            'allows residual literal percent text without a hex triplet: %s',
            (encodedVideoId, expected) => {
                expect(normalizeDisneyPlusVideoId(encodedVideoId)).toBe(
                    expected
                );
                expect(
                    extractDisneyPlusVideoIdFromPathname(
                        `/video/${encodedVideoId}`
                    )
                ).toBe(expected);
            }
        );

        test('rejects IDs over the UTF-8-byte cap', () => {
            expect(
                normalizeDisneyPlusVideoId(
                    'a'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1)
                )
            ).toBeNull();
            expect(
                normalizeDisneyPlusVideoId(
                    'é'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES / 2 + 1)
                )
            ).toBeNull();
            expect(
                normalizeDisneyPlusVideoId(
                    '%61'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1)
                )
            ).toBeNull();
        });

        test('parses URLs separately from pathname extraction', () => {
            expect(
                extractDisneyPlusVideoIdFromUrl(
                    'https://www.disneyplus.com/zh-hans/video/opaque%20id/?lang=en'
                )
            ).toBe('opaque id');
            expect(
                extractDisneyPlusVideoIdFromUrl('not an absolute URL')
            ).toBeNull();
        });
    });

    describe('Netflix canonical route identity', () => {
        test.each([
            ['/watch/123456', '123456'],
            ['/watch/00123/', '00123'],
        ])('accepts exact terminal watch pathname %s', (pathname, expected) => {
            expect(extractNetflixVideoIdFromPathname(pathname)).toBe(expected);
        });

        test.each([
            '/en/watch/123456',
            '/browse/watch/123456',
            '/watch/123456/extra',
            '/watch/123456?extra=true',
            '/watch/123abc',
            '/watch/-123',
            '/watch/%31%32%33',
            '/watch/',
        ])('rejects noncanonical pathname %s', (pathname) => {
            expect(extractNetflixVideoIdFromPathname(pathname)).toBeNull();
        });

        test('normalizes JSON-safe numeric IDs and rejects other values', () => {
            expect(normalizeNetflixVideoId(123456)).toBe('123456');
            expect(normalizeNetflixVideoId('123456')).toBe('123456');

            for (const value of [
                -1,
                1.5,
                Number.NaN,
                Number.POSITIVE_INFINITY,
                Number.MAX_SAFE_INTEGER + 1,
                '123x',
                '',
                null,
                {},
            ]) {
                expect(normalizeNetflixVideoId(value)).toBeNull();
            }
        });

        test('rejects IDs over the provisional cap', () => {
            expect(
                normalizeNetflixVideoId('1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES))
            ).toBe('1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES));
            expect(
                normalizeNetflixVideoId(
                    '1'.repeat(MAX_SUBTITLE_ROUTE_ID_BYTES + 1)
                )
            ).toBeNull();
        });

        test('parses URLs separately from pathname extraction', () => {
            expect(
                extractNetflixVideoIdFromUrl(
                    'https://www.netflix.com/watch/987654/?trackId=1'
                )
            ).toBe('987654');
            expect(
                extractNetflixVideoIdFromUrl('not an absolute URL')
            ).toBeNull();
        });
    });
});
