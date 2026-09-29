import { describe, expect, it } from 'vitest';
import { prepareContentPreview } from './preview';

describe('prepareContentPreview', () => {
    it('canonicalizes display values', () => {
        expect(
            prepareContentPreview({
                subtitleFontScale: 1.5,
                subtitlesEnabled: false,
            })
        ).toEqual({ subtitleFontScale: 1.5, subtitlesEnabled: false });
    });

    it('rejects keys outside the display set', () => {
        expect(() => prepareContentPreview({ targetLanguage: 'ja' })).toThrow(
            TypeError
        );
        expect(() => prepareContentPreview({ deeplApiKey: 'x' })).toThrow(
            TypeError
        );
    });

    it('rejects the whole payload when any value is invalid', () => {
        expect(() =>
            prepareContentPreview({ subtitleFontScale: 1.5, subtitleGap: 9 })
        ).toThrow(TypeError);
    });
});
