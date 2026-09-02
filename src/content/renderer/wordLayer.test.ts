// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { WordLayer, type WordIntent } from './wordLayer';

function layer() {
    const intents: WordIntent[] = [];
    const element = document.createElement('div');
    document.body.append(element);
    const words = new WordLayer({
        language: () => 'en',
        onIntent: (intent) => intents.push(intent),
    });
    return { words, element, intents };
}

function spans(element: HTMLElement): HTMLSpanElement[] {
    return [...element.querySelectorAll('span')];
}

describe('WordLayer', () => {
    it('paints one span per word and keeps the separators as text', () => {
        const { words, element } = layer();
        words.paint(element, "I don't know.", 4);
        expect(element.textContent).toBe("I don't know.");
        expect(spans(element).map((span) => span.textContent)).toEqual([
            'I',
            "don't",
            'know',
        ]);
        expect(spans(element).map((span) => span.dataset.wordIndex)).toEqual([
            '0',
            '1',
            '2',
        ]);
        expect(spans(element)[0]!.getAttribute('role')).toBe('button');
    });

    it('turns clicks and keyboard activation into intents for the painted revision', () => {
        const { words, element, intents } = layer();
        words.paint(element, 'hola amigo', 4);
        const [hola, amigo] = spans(element);
        hola!.click();
        amigo!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
        amigo!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'x', bubbles: true })
        );
        element.click();
        expect(intents).toEqual([
            { renderRevision: 4, wordIndex: 0, word: 'hola' },
            { renderRevision: 4, wordIndex: 1, word: 'amigo' },
        ]);
    });

    it('ignores spans that are no longer the registered occurrence', () => {
        const { words, element, intents } = layer();
        words.paint(element, 'hola amigo', 4);
        const stale = spans(element)[0]!;
        words.paint(element, 'adios amigo', 5);
        element.append(stale);
        stale.click();
        expect(intents).toEqual([]);
        words.forget();
        spans(element)[0]!.click();
        expect(intents).toEqual([]);
    });

    it('shows the selected indices it is told about', () => {
        const { words, element } = layer();
        words.paint(element, 'hola amigo', 4);
        words.setSelected([1]);
        const [hola, amigo] = spans(element);
        expect(amigo!.getAttribute('aria-pressed')).toBe('true');
        expect(amigo!.style.backgroundColor).not.toBe('');
        expect(hola!.getAttribute('aria-pressed')).toBe('false');
        words.setSelected([]);
        expect(amigo!.style.backgroundColor).toBe('');
    });

    it('highlights on hover only while a word is not selected', () => {
        const { words, element } = layer();
        words.paint(element, 'hola amigo', 4);
        const [hola, amigo] = spans(element);
        words.setSelected([1]);
        hola!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(hola!.style.backgroundColor).not.toBe('');
        hola!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        expect(hola!.style.backgroundColor).toBe('');
        const selectedBackground = amigo!.style.backgroundColor;
        amigo!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(amigo!.style.backgroundColor).toBe(selectedBackground);
    });

    it('rebinds listeners when the element changes and stops on destroy', () => {
        const { words, element, intents } = layer();
        words.paint(element, 'hola', 1);
        const replacement = document.createElement('div');
        document.body.append(replacement);
        words.paint(replacement, 'adios', 2);
        spans(replacement)[0]!.click();
        expect(intents).toEqual([
            { renderRevision: 2, wordIndex: 0, word: 'adios' },
        ]);
        words.destroy();
        spans(replacement)[0]!.click();
        expect(intents).toHaveLength(1);
        vi.restoreAllMocks();
    });
});
