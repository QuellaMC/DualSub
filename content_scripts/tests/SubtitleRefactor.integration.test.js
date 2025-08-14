/**
 * Subtitle Refactor Integration Tests
 */

import {
    initializeInteractiveSubtitles,
    formatInteractiveSubtitleText,
    getStableSpanId,
} from '../shared/interactiveSubtitleFormatter.js';
import { computeTextSignature } from '../shared/subtitleUtilities.js';

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
});
