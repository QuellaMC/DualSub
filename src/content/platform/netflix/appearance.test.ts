import { describe, expect, it } from 'vitest';
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

    it('merges the window behind the block into the line box when the text has no background', () => {
        expect(
            withOverrides({
                windowColor: 'BLACK',
                windowOpacity: 'SEMI_TRANSPARENT',
            }).background
        ).toBe('rgba(0, 0, 0, 0.5)');
        expect(
            withOverrides({
                backgroundColor: 'BLUE',
                windowColor: 'BLACK',
                windowOpacity: 'SEMI_TRANSPARENT',
            }).background
        ).toBe('#0000ff');
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
