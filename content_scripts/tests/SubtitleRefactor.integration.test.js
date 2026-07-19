/**
 * Subtitle Refactor Integration Tests
 */

import {
    initializeInteractiveSubtitles,
    formatInteractiveSubtitleText,
    getStableSpanId,
} from '../shared/interactiveSubtitleFormatter.js';
import {
    computeTextSignature,
    resolvePlaybackTime,
} from '../shared/subtitleUtilities.js';

describe('Subtitle Refactor - Deterministic Spans and Signatures', () => {
    test('Deterministic spans: stable IDs and data attributes', () => {
        initializeInteractiveSubtitles({ enabled: true, clickableWords: true });
        const text = 'Hello 世界 123';
        const html = formatInteractiveSubtitleText(text, {
            sourceLanguage: 'en',
            targetLanguage: 'ja',
            subtitleType: 'original',
        });

        const container = document.createElement('div');
        container.innerHTML = html;
        const spans = Array.from(
            container.querySelectorAll('.dualsub-interactive-word')
        );

        // Expect 3 tokens: Hello, 世界, 123
        expect(spans.length).toBe(3);

        spans.forEach((span, i) => {
            expect(span.id).toBe(getStableSpanId('original', i));
            expect(span.getAttribute('data-subtitle-type')).toBe('original');
            expect(Number(span.getAttribute('data-word-index'))).toBe(i);
        });
    });

    test('computeTextSignature: ignores random IDs/HTML differences', () => {
        const a = "Hello <span id='x123'>world</span> &nbsp;!";
        const b = "Hello <span id='y456'>world</span>!";
        const sigA = computeTextSignature(a);
        const sigB = computeTextSignature(b);

        expect(sigA).toBe(sigB);
        expect(sigA).toBe('Hello world');
    });

    test('resolvePlaybackTime prefers the platform clock over raw video time', () => {
        const video = { currentTime: 401 };
        const platform = {
            getPlaybackTime: () => 1001,
            getVideoElement: () => video,
        };

        expect(resolvePlaybackTime(platform, video)).toBe(1001);
    });

    test('resolvePlaybackTime falls back to raw video time for older adapters', () => {
        const video = { currentTime: 25 };

        expect(resolvePlaybackTime({ getVideoElement: () => video })).toBe(25);
    });

    test.each([
        ['Tom & Jerry', ['Tom', 'Jerry']],
        ['2 < 3', ['2', '3']],
        [`He said "don't"`, ['He', 'said', "don't"]],
        [
            '<img src=x onerror="alert(1)">',
            ['img', 'src', 'x', 'onerror', 'alert', '1'],
        ],
    ])(
        'wraps visible tokens without inventing HTML-entity words: %s',
        (text, words) => {
            initializeInteractiveSubtitles({
                enabled: true,
                clickableWords: true,
            });

            const container = document.createElement('div');
            container.innerHTML = formatInteractiveSubtitleText(text, {
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                subtitleType: 'original',
            });

            expect(container.textContent).toBe(text);
            expect(
                Array.from(
                    container.querySelectorAll('.dualsub-interactive-word'),
                    (span) => span.textContent
                )
            ).toEqual(words);
            expect(container.querySelector('img')).toBeNull();
            expect(container.querySelector('[onerror]')).toBeNull();
        }
    );
});
