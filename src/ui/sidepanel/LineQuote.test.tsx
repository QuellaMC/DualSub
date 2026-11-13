// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Translate } from '../hooks/useI18n';
import { LineQuote } from './LineQuote';

const t = ((key: string) => key) as Translate;

function tokens(text: string, language: string) {
    render(
        <LineQuote
            t={t}
            line={{ text, language, translation: null }}
            entries={[]}
            onToggle={null}
        />
    );
    const line = screen
        .getByRole('region', { name: 'sidepanelLineLabel' })
        .querySelector('.line')!;
    return {
        text: line.textContent,
        tokens: [...line.querySelectorAll('.token')].map(
            (token) => token.textContent
        ),
    };
}

afterEach(cleanup);

describe('LineQuote', () => {
    it('keeps every character of the line, its punctuation with the word it clings to', () => {
        const text = '¿Está lloviendo — a cántaros? No salgas.';
        expect(tokens(text, 'es')).toEqual({
            text,
            tokens: [
                '¿Está',
                'lloviendo',
                '—',
                'a',
                'cántaros?',
                'No',
                'salgas.',
            ],
        });
    });

    it('splits words written without spaces into a token each', () => {
        expect(tokens('你好，世界', 'zh')).toEqual({
            text: '你好，世界',
            tokens: ['你好，', '世界'],
        });
    });
});
