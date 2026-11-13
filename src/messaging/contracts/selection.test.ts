import { describe, expect, it } from 'vitest';
import {
    createPlainDataSnapshot,
    PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS,
} from '../snapshot';
import { MessageActions } from '../actions';
import {
    contentSelectionSnapshot,
    SELECTION_SNAPSHOT_LIMITS,
    selectionState,
    type ContentSelectionSnapshot,
} from './selection';
import { backgroundToPanel } from './sidepanelPort';

const LINE = { text: 'hola mi amigo', language: 'es', translation: null };

function snapshot(
    overrides: Partial<ContentSelectionSnapshot> = {}
): ContentSelectionSnapshot {
    return {
        lifecycleGeneration: 1,
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'toggle',
        entries: [{ wordIndex: 2, word: 'amigo' }],
        line: LINE,
        ...overrides,
    };
}

const valid = (value: unknown) =>
    contentSelectionSnapshot.safeParse(value).success;

describe('selection snapshot', () => {
    it('carries a line except for a new line or a cleared selection', () => {
        expect(valid(snapshot())).toBe(true);
        expect(valid(snapshot({ entries: [], reason: 'remove' }))).toBe(true);
        expect(valid(snapshot({ line: null }))).toBe(false);
        for (const reason of ['subtitle-change', 'clear'] as const) {
            expect(valid(snapshot({ reason, entries: [], line: null }))).toBe(
                true
            );
            expect(valid(snapshot({ reason, entries: [] }))).toBe(false);
        }
        expect(valid(snapshot({ reason: 'add', entries: [] }))).toBe(false);
    });

    it('holds only words the line has at their index', () => {
        expect(
            valid(snapshot({ entries: [{ wordIndex: 1, word: 'amigo' }] }))
        ).toBe(false);
        expect(
            valid(snapshot({ entries: [{ wordIndex: 3, word: 'amigo' }] }))
        ).toBe(false);
    });

    it('caps the line and its translation', () => {
        const line = (text: string, translation: string | null = null) =>
            snapshot({
                entries: [],
                line: { text, language: null, translation },
            });
        expect(valid(line('a'.repeat(500)))).toBe(true);
        expect(valid(line('a'.repeat(501)))).toBe(false);
        expect(valid(line('   '))).toBe(false);
        expect(valid(line('hola', '漢'.repeat(1000)))).toBe(true);
        expect(valid(line('hola', '漢'.repeat(1001)))).toBe(false);
    });

    it('fits the largest snapshot through both the runtime and the port budgets', () => {
        const words = Array.from({ length: 64 }, () => 'éééééé');
        const spoken = words.join(' ');
        const largest = snapshot({
            reason: 'translation',
            entries: words.map((word, index) => ({ wordIndex: index, word })),
            line: {
                text: spoken + '—'.repeat(500 - spoken.length),
                language: 'es-419-u-ca-gregory',
                translation: '漢'.repeat(1000),
            },
        });
        expect(valid(largest)).toBe(true);
        expect(() =>
            createPlainDataSnapshot(
                {
                    action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                    data: largest,
                },
                SELECTION_SNAPSHOT_LIMITS
            )
        ).not.toThrow();

        const state = {
            session: 'd'.repeat(256),
            selectionOwnerGeneration: 1,
            selectionRevision: largest.selectionRevision,
            renderRevision: largest.renderRevision,
            reason: largest.reason,
            entries: largest.entries,
            line: largest.line,
        };
        expect(selectionState.safeParse(state).success).toBe(true);
        const frame = {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 1, tabId: 1, windowId: 1 },
                selection: state,
            },
        };
        expect(backgroundToPanel.safeParse(frame).success).toBe(true);
        expect(() =>
            createPlainDataSnapshot(frame, PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS)
        ).not.toThrow();
    });
});
