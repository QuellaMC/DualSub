import { describe, expect, it } from 'vitest';
import {
    selectYouTubeOriginal,
    selectYouTubeTranslation,
    type YouTubeTrackChoice,
} from './youtubeTracks';

const track = (language: string, asr = false): YouTubeTrackChoice => ({
    language,
    asr,
});

describe('selectYouTubeOriginal', () => {
    it('prefers captions a person wrote over speech recognition', () => {
        const written = track('en');
        expect(selectYouTubeOriginal([track('en', true), written], 'en')).toBe(
            written
        );
    });

    it('matches languages by their normalized code', () => {
        const chinese = track('zh-Hans');
        expect(selectYouTubeOriginal([track('en'), chinese], 'zh-CN')).toBe(
            chinese
        );
    });

    it('falls back to English, then to the first track', () => {
        const french = track('fr', true);
        const english = track('en', true);
        expect(selectYouTubeOriginal([french, english], 'sv')).toBe(english);
        expect(selectYouTubeOriginal([french], 'sv')).toBe(french);
        expect(selectYouTubeOriginal([], 'sv')).toBeNull();
    });
});

describe('selectYouTubeTranslation', () => {
    it('takes only captions a person wrote, with no fallback', () => {
        const written = track('ja');
        expect(
            selectYouTubeTranslation([track('ja', true), written], 'ja')
        ).toBe(written);
        expect(selectYouTubeTranslation([track('ja', true)], 'ja')).toBeNull();
        expect(selectYouTubeTranslation([track('en')], 'ja')).toBeNull();
    });
});
