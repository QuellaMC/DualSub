import { describe, expect, it } from 'vitest';
import { forLanguage } from '../../renderer/looks';
import {
    NETFLIX_DEFAULT_APPEARANCE,
    NETFLIX_LOOK,
    parseNetflixLook,
} from './appearance';

const MAPPING = {
    PROPORTIONAL_SANS_SERIF:
        'font-family:Netflix Sans,Helvetica Nueue,Helvetica,Arial,sans-serif;font-weight:bolder',
    MONOSPACED_SERIF:
        'font-family:Courier New,Arial,Helvetica;font-weight:bolder',
    SMALL_CAPITALS:
        'font-family:Netflix Sans,Copperplate Gothic,Arial;font-variant:small-caps;font-weight:bolder',
};

function withOverrides(overrides: Record<string, string | null>) {
    return parseNetflixLook({
        ...NETFLIX_DEFAULT_APPEARANCE,
        overrides,
        fontFamilyMapping: MAPPING,
    })!;
}

describe('parseNetflixLook', () => {
    it('draws a fresh profile as the player does', () => {
        expect(NETFLIX_LOOK).toMatchObject({
            fontFamily:
                'Netflix Sans,Helvetica Nueue,Helvetica,Arial,sans-serif',
            fontWeight: 'bold',
            fontVariant: 'normal',
            originalColor: '#ffffff',
            textShadow: '#000000 0px 0px 7px',
            textStroke: '',
            background: 'transparent',
            padding: '0',
        });
        expect(NETFLIX_LOOK.sizeRatio).toBeCloseTo(1 / 19, 6);
    });

    it('lets non-null overrides win and maps every table', () => {
        const look = withOverrides({
            characterSize: 'LARGE',
            characterStyle: 'MONOSPACED_SERIF',
            characterColor: 'YELLOW',
            characterOpacity: 'SEMI_TRANSPARENT',
            characterEdgeAttributes: 'UNIFORM',
            characterEdgeColor: 'RED',
            backgroundColor: 'BLACK',
            backgroundOpacity: 'SEMI_TRANSPARENT',
        });
        expect(look).toMatchObject({
            fontFamily: 'Courier New,Arial,Helvetica',
            fontWeight: 'bold',
            originalColor: 'rgba(255, 255, 0, 0.5)',
            textShadow:
                '-1px 0px #ff0000, 0px 1px #ff0000, 1px 0px #ff0000, 0px -1px #ff0000',
            background: 'rgba(0, 0, 0, 0.5)',
        });
        // Large text gets no monospace enlargement.
        expect(look.sizeRatio).toBeCloseTo(2 / 19, 6);
        expect(look.languageOverrides).toEqual({
            th: { fontWeight: 'normal' },
            ta: { fontWeight: 'normal' },
        });
    });

    it('enlarges monospaced text at small and medium sizes', () => {
        expect(
            withOverrides({ characterStyle: 'MONOSPACED_SERIF' }).sizeRatio
        ).toBeCloseTo(1.15 / 19, 6);
        expect(
            withOverrides({
                characterStyle: 'MONOSPACED_SERIF',
                characterSize: 'SMALL',
            }).sizeRatio
        ).toBeCloseTo((0.5 * 1.15) / 19, 6);
    });

    it('keeps small capitals as a font variant', () => {
        expect(
            withOverrides({ characterStyle: 'SMALL_CAPITALS' })
        ).toMatchObject({
            fontFamily: 'Netflix Sans,Copperplate Gothic,Arial',
            fontVariant: 'small-caps',
        });
    });

    it('maps the raised, depressed, and absent edges', () => {
        expect(
            withOverrides({ characterEdgeAttributes: 'RAISED' }).textShadow
        ).toBe(
            '-1px -1px white, 0px -1px white, -1px 0px white, 1px 1px black, 0px 1px black, 1px 0px black'
        );
        const depressed =
            '1px 1px white, 0px 1px white, 1px 0px white, -1px -1px black, 0px -1px black, -1px 0px black';
        expect(
            withOverrides({ characterEdgeAttributes: 'DEPRESED' }).textShadow
        ).toBe(depressed);
        expect(
            withOverrides({ characterEdgeAttributes: 'DEPRESSED' }).textShadow
        ).toBe(depressed);
        expect(
            withOverrides({ characterEdgeAttributes: 'NONE' }).textShadow
        ).toBe('none');
    });

    it('enlarges the languages the player enlarges, per size', () => {
        expect(forLanguage(NETFLIX_LOOK, 'zh-CN').sizeRatio).toBeCloseTo(
            1.4 / 19,
            6
        );
        expect(forLanguage(NETFLIX_LOOK, 'zh-Hant').sizeRatio).toBeCloseTo(
            1.4 / 19,
            6
        );
        expect(forLanguage(NETFLIX_LOOK, 'ko').sizeRatio).toBeCloseTo(
            1 / 19,
            6
        );
        expect(forLanguage(NETFLIX_LOOK, 'en').sizeRatio).toBeCloseTo(
            1 / 19,
            6
        );

        const small = withOverrides({ characterSize: 'SMALL' });
        expect(forLanguage(small, 'ko').sizeRatio).toBeCloseTo(
            (0.5 * 1.6) / 19,
            6
        );
        expect(forLanguage(NETFLIX_LOOK, 'th').fontWeight).toBe('normal');
    });

    it('accepts hex colors and falls back for names it does not know', () => {
        expect(withOverrides({ characterColor: '#abc' }).originalColor).toBe(
            '#aabbcc'
        );
        expect(
            withOverrides({ characterColor: 'chartreuse' }).originalColor
        ).toBe('#ffffff');
        expect(
            withOverrides({
                backgroundColor: 'WHITE',
                backgroundOpacity: 'NONE',
            }).background
        ).toBe('transparent');
    });

    it('rejects payloads without the defaults record', () => {
        expect(parseNetflixLook({})).toBeNull();
        expect(parseNetflixLook({ defaults: 'MEDIUM' })).toBeNull();
        expect(parseNetflixLook({ defaults: ['MEDIUM'] })).toBeNull();
    });
});
