import { describe, expect, it } from 'vitest';
import { DISNEY_LOOK, parseDisneyLook } from './appearance';

/** A profile's settings as the player reported them on 2026-09-25. */
const CAPTURED = {
    backgroundColor: 'rgba(0,0,0,0.75)',
    windowColor: 'rgba(255,255,255,0)',
    textColor: 'rgba(255,255,255,1)',
    font: 'default',
    textEdge: 'none',
    fontMappingOverride: {
        default: { 'font-family': 'sans-serif' },
        japanese: {
            'font-family':
                'Hiragino Kaku Gothic ProN, Hiragino Sans, Meiryo, sans-serif',
        },
        script: { 'font-family': 'DancingScript' },
    },
};

describe('parseDisneyLook', () => {
    it('draws the captured profile as the player does', () => {
        const look = parseDisneyLook(CAPTURED)!;
        expect(look).toMatchObject({
            fontFamily: 'sans-serif',
            fontWeight: 'normal',
            fontVariant: 'normal',
            originalColor: 'rgba(255,255,255,1)',
            background: 'rgba(0,0,0,0.75)',
            textShadow: 'none',
            textStroke: '',
            padding: '0.5rem',
            borderRadius: '0.5em',
        });
    });

    it('has a clear default look', () => {
        expect(DISNEY_LOOK.background).toBe('rgba(0,0,0,0)');
        expect(DISNEY_LOOK.textShadow).toBe('none');
    });

    it('maps edges to shadows and strokes', () => {
        expect(
            parseDisneyLook({ ...CAPTURED, textEdge: 'raised' })
        ).toMatchObject({
            textShadow: '2px 2px 0 rgba(0,0,0,.5)',
            textStroke: '',
        });
        expect(
            parseDisneyLook({ ...CAPTURED, textEdge: 'uniform' })
        ).toMatchObject({ textShadow: 'none', textStroke: '1.5px #000' });
        expect(
            parseDisneyLook({ ...CAPTURED, textEdge: 'shadow' })
        ).toMatchObject({ textShadow: '2px 2px 2px rgba(0,0,0,.5)' });
        expect(
            parseDisneyLook({ ...CAPTURED, textEdge: 'outline' })
        ).toMatchObject({ textStroke: '2px #000' });
    });

    it('follows the font setting through the base table and overrides', () => {
        expect(
            parseDisneyLook({ ...CAPTURED, font: 'small-caps' })
        ).toMatchObject({
            fontFamily: 'Arial, sans-serif',
            fontVariant: 'small-caps',
        });
        expect(parseDisneyLook({ ...CAPTURED, font: 'script' })).toMatchObject({
            fontFamily: 'DancingScript',
        });
        expect(parseDisneyLook({ ...CAPTURED, font: 'unknown' })).toMatchObject(
            { fontFamily: 'sans-serif' }
        );
    });

    it('falls back for colors it cannot trust', () => {
        expect(
            parseDisneyLook({
                ...CAPTURED,
                textColor: 'url(evil)',
                backgroundColor: 'red',
            })
        ).toMatchObject({
            originalColor: '#ffffff',
            background: 'transparent',
        });
    });

    it('rejects payloads carrying none of the appearance settings', () => {
        expect(parseDisneyLook({})).toBeNull();
        expect(parseDisneyLook({ size: 'medium', sizeScalar: 3.3 })).toBeNull();
    });
});
