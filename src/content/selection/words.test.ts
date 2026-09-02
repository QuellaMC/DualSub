import { describe, expect, it } from 'vitest';
import { segmentWords } from './words';

describe('segmentWords', () => {
    it('splits Latin text into words, keeping contractions whole', () => {
        expect(segmentWords("I don't know, Mr. Smith!", 'en')).toEqual([
            { word: 'I', start: 0, end: 1 },
            { word: "don't", start: 2, end: 7 },
            { word: 'know', start: 8, end: 12 },
            { word: 'Mr', start: 14, end: 16 },
            { word: 'Smith', start: 18, end: 23 },
        ]);
    });

    it('splits Chinese and Japanese without spaces', () => {
        const chinese = segmentWords('我喜欢北京的天气', 'zh-CN').map(
            ({ word }) => word
        );
        expect(chinese.length).toBeGreaterThan(2);
        expect(chinese.join('')).toBe('我喜欢北京的天气');

        const japanese = segmentWords('私は学生です', 'ja').map(
            ({ word }) => word
        );
        expect(japanese.length).toBeGreaterThan(2);
        expect(japanese.join('')).toBe('私は学生です');
    });

    it('treats digits as words and ignores punctuation and whitespace', () => {
        expect(segmentWords('  ... 42 %  ', 'en')).toEqual([
            { word: '42', start: 6, end: 8 },
        ]);
        expect(segmentWords('', 'en')).toEqual([]);
    });

    it('falls back to root rules for an unknown locale', () => {
        expect(
            segmentWords('hello world', 'not a locale').map(({ word }) => word)
        ).toEqual(['hello', 'world']);
    });
});
