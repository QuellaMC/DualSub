import {
    initializeInteractiveSubtitles,
    formatInteractiveSubtitleText,
    getStableSpanId,
} from '../shared/interactiveSubtitleFormatter.js';
import {
    computeTextSignature,
    resolvePlaybackTime,
} from '../shared/subtitleUtilities.js';

describe('subtitle formatting helpers', () => {
    test('uses stable span IDs and data attributes', () => {
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

        expect(spans.length).toBe(3);

        spans.forEach((span, i) => {
            expect(span.id).toBe(getStableSpanId('original', i));
            expect(span.getAttribute('data-subtitle-type')).toBe('original');
            expect(Number(span.getAttribute('data-word-index'))).toBe(i);
        });
    });

    test('text signatures ignore HTML IDs and equivalent punctuation', () => {
        const a = "Hello <span id='x123'>world</span> &nbsp;!";
        const b = "Hello <span id='y456'>world</span>!";
        const sigA = computeTextSignature(a);
        const sigB = computeTextSignature(b);

        expect(sigA).toBe(sigB);
        expect(sigA).toBe('Hello world');
    });

    test.each([
        ['platform clock', { getPlaybackTime: () => 1001 }, 401, 1001],
        ['video fallback', {}, 25, 25],
    ])(
        'resolves playback time from the %s',
        (_label, platform, videoTime, expected) => {
            const video = { currentTime: videoTime };
            expect(
                resolvePlaybackTime(
                    { ...platform, getVideoElement: () => video },
                    video
                )
            ).toBe(expected);
        }
    );

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
