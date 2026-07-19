import { describe, expect, test } from '@jest/globals';
import { SelectionModel } from '../core/state/SelectionModel.js';

describe('SelectionModel occurrence identity', () => {
    test('preserves identical words selected at distinct occurrence indices', () => {
        const model = new SelectionModel();
        model.add('echo', { wordIndex: 3 }, 'echo-3');
        model.add('echo', { wordIndex: 1 }, 'echo-1');

        expect({
            removed: model.removeDuplicatesPreferOriginal(),
            entries: model.getOrderedEntries(),
        }).toEqual({
            removed: 0,
            entries: [
                { wordIndex: 1, word: 'echo' },
                { wordIndex: 3, word: 'echo' },
            ],
        });
    });

    test('keeps the original subtitle representation for one occurrence', () => {
        const model = new SelectionModel();
        model.add(
            'translated',
            { wordIndex: 4, subtitleType: 'translated', element: {} },
            'translated-4'
        );
        model.add(
            'original',
            { wordIndex: 4, subtitleType: 'original', element: {} },
            'original-4'
        );
        expect({
            removed: model.removeDuplicatesPreferOriginal(),
            keptOriginal: model.has('original-4'),
            keptTranslated: model.has('translated-4'),
            entries: model.getOrderedEntries(),
        }).toEqual({
            removed: 1,
            keptOriginal: true,
            keptTranslated: false,
            entries: [{ wordIndex: 4, word: 'original' }],
        });
    });

    test('keeps distinct unindexed records separate and omits them from projection', () => {
        const model = new SelectionModel();
        model.add('echo', {}, 'unindexed-a');
        model.add('echo', {}, 'unindexed-b');

        expect({
            removed: model.removeDuplicatesPreferOriginal(),
            keys: model.getPositionKeyOrder(),
            entries: model.getOrderedEntries(),
        }).toEqual({
            removed: 0,
            keys: ['unindexed-a', 'unindexed-b'],
            entries: [],
        });
    });

    test('accepts only nonnegative safe-integer occurrence indices', () => {
        const model = new SelectionModel();
        model.add('missing', {}, 'missing');
        model.add('negative', { wordIndex: -1 }, 'negative');
        model.add(
            'invalid-primary',
            { wordIndex: -1, index: 1 },
            'invalid-primary'
        );
        model.add('zero', { wordIndex: 0 }, 'zero');
        model.add('fractional', { wordIndex: 1.5 }, 'fractional');
        model.add(
            'unsafe',
            { wordIndex: Number.MAX_SAFE_INTEGER + 1 },
            'unsafe'
        );
        model.add('nan', { wordIndex: Number.NaN }, 'nan');
        model.add('fallback', { index: 2 }, 'fallback');

        expect({
            entries: model.getOrderedEntries(),
            text: model.updateSelectedText(),
        }).toEqual({
            entries: [
                { wordIndex: 0, word: 'zero' },
                { wordIndex: 2, word: 'fallback' },
            ],
            text: 'zero fallback missing negative invalid-primary fractional unsafe nan',
        });
    });

    test('projects preferred equal-index records in stable order as fresh data', () => {
        const model = new SelectionModel();
        model.add('plain', { wordIndex: 4 }, 'plain-4');
        model.add(
            'translated',
            { wordIndex: 4, subtitleType: 'translated', element: {} },
            'translated-4'
        );
        model.add('earlier', { wordIndex: 2 }, 'earlier-2');
        model.add(
            'original',
            { wordIndex: 4, subtitleType: 'original', element: {} },
            'original-4'
        );
        model.add('plain-later', { wordIndex: 6 }, 'plain-6');
        model.add(
            'first-element',
            { wordIndex: 6, subtitleType: 'translated', element: {} },
            'first-element-6'
        );
        model.add(
            'second-element',
            { wordIndex: 6, subtitleType: 'translated', element: {} },
            'second-element-6'
        );

        const firstProjection = model.getOrderedEntries();
        firstProjection[0].word = 'mutated';
        firstProjection.push({ wordIndex: 99, word: 'injected' });

        expect({
            entries: model.getOrderedEntries(),
            sizeBeforeDedupe: model.getPositionsMap().size,
            textBeforeDedupe: model.updateSelectedText(),
            removed: model.removeDuplicatesPreferOriginal(),
            remainingKeys: model.getPositionKeyOrder(),
        }).toEqual({
            entries: [
                { wordIndex: 2, word: 'earlier' },
                { wordIndex: 4, word: 'original' },
                { wordIndex: 6, word: 'first-element' },
            ],
            sizeBeforeDedupe: 7,
            textBeforeDedupe:
                'earlier plain translated original plain-later first-element second-element',
            removed: 4,
            remainingKeys: ['earlier-2', 'original-4', 'first-element-6'],
        });
    });
});
