import { describe, expect, it, vi } from 'vitest';
import type { ContentSelectionSnapshot } from '@/messaging/contracts/selection';
import type { PaintedLine } from '../renderer/Renderer';
import {
    allocateLifecycleGeneration,
    SelectionAuthority,
    type EditCommand,
} from './SelectionAuthority';

/** Words: hola 0, mi 1, buen 2, amigo 3. */
const TEXT = 'hola mi buen amigo';

const painted = (
    text = TEXT,
    translation: string | null = null
): PaintedLine => ({ text, language: 'es', translation });

const line = (translation: string | null = null) => ({
    text: TEXT,
    language: 'es',
    translation,
});

function harness(
    options: { accept?: (snapshot: ContentSelectionSnapshot) => boolean } = {}
) {
    const published: ContentSelectionSnapshot[] = [];
    const shown: number[][] = [];
    let gate: Promise<void> = Promise.resolve();
    let release: () => void = () => undefined;
    const publish = vi.fn(async (snapshot: ContentSelectionSnapshot) => {
        published.push(snapshot);
        await gate;
        return options.accept?.(snapshot) ?? true;
    });
    const authority = new SelectionAuthority({
        lifecycleGeneration: 7,
        publish,
        onSelectionChanged: (indices) => shown.push([...indices].sort()),
    });
    return {
        authority,
        published,
        shown,
        publish,
        /** Hold every publication until released. */
        hold: () => {
            gate = new Promise((resolve) => {
                release = resolve;
            });
        },
        release: () => {
            release();
        },
    };
}

/** Let every queued publication settle. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

const intent = (wordIndex: number, word: string, renderRevision = 1) => ({
    renderRevision,
    wordIndex,
    word,
});

const edit = (overrides: Partial<EditCommand> = {}): EditCommand => ({
    requestId: 9,
    lifecycleGeneration: 7,
    selectionRevision: 2,
    renderRevision: 1,
    wordIndex: 0,
    op: 'remove',
    ...overrides,
});

describe('SelectionAuthority', () => {
    it('allocates distinct monotonic lifecycle generations', () => {
        const first = allocateLifecycleGeneration();
        expect(allocateLifecycleGeneration()).toBe(first + 1);
    });

    it('publishes the first line, then only lines that clear something', async () => {
        const { authority, published } = harness();
        authority.onLinePainted(1, painted());
        authority.onLinePainted(2, painted());
        await flush();
        expect(published).toEqual([
            {
                lifecycleGeneration: 7,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'subtitle-change',
                entries: [],
                line: null,
            },
        ]);
        expect(authority.toggle(intent(0, 'hola', 2))).toBe('added');
        authority.onLinePainted(3, painted());
        await flush();
        expect(published.map((snapshot) => snapshot.reason)).toEqual([
            'subtitle-change',
            'toggle',
            'subtitle-change',
        ]);
        expect(published[2]).toMatchObject({
            selectionRevision: 4,
            renderRevision: 3,
            entries: [],
            line: null,
        });
    });

    it('ignores stale render revisions', () => {
        const { authority, shown } = harness();
        authority.onLinePainted(2, painted());
        authority.toggle(intent(0, 'hola', 2));
        authority.onLinePainted(1, painted());
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(shown.at(-1)).toEqual([0]);
    });

    it('toggles words of the current line in sentence order and carries the line', async () => {
        const { authority, published, shown } = harness();
        authority.onLinePainted(1, painted());
        expect(authority.toggle(intent(3, 'amigo'))).toBe('added');
        expect(authority.toggle(intent(0, 'hola'))).toBe('added');
        expect(authority.toggle(intent(3, 'amigo'))).toBe('removed');
        expect(authority.toggle(intent(0, 'hola', 2))).toBeNull();
        expect(authority.toggle(intent(0, ''))).toBeNull();
        expect(authority.toggle(intent(1, 'adios'))).toBeNull();
        await flush();
        expect(published.slice(1)).toEqual([
            {
                lifecycleGeneration: 7,
                selectionRevision: 2,
                renderRevision: 1,
                reason: 'toggle',
                entries: [{ wordIndex: 3, word: 'amigo' }],
                line: line(),
            },
            {
                lifecycleGeneration: 7,
                selectionRevision: 3,
                renderRevision: 1,
                reason: 'toggle',
                entries: [
                    { wordIndex: 0, word: 'hola' },
                    { wordIndex: 3, word: 'amigo' },
                ],
                line: line(),
            },
            {
                lifecycleGeneration: 7,
                selectionRevision: 4,
                renderRevision: 1,
                reason: 'toggle',
                entries: [{ wordIndex: 0, word: 'hola' }],
                line: line(),
            },
        ]);
        expect(shown).toEqual([[], [3], [0, 3], [0]]);
    });

    it('refuses a click a snapshot cannot carry, changing nothing', async () => {
        const { authority, published } = harness();
        const words = Array.from({ length: 70 }, (_, index) => `w${index}`);
        authority.onLinePainted(1, painted(words.join(' ')));
        for (let index = 0; index < 64; index += 1) {
            expect(authority.toggle(intent(index, words[index]!))).toBe(
                'added'
            );
        }
        expect(authority.toggle(intent(64, 'w64'))).toBeNull();
        await flush();
        expect(authority.selectedIndices.size).toBe(64);
        expect(published).toHaveLength(65);
    });

    it('sends a translation that reaches a selected line, without one too long to send', async () => {
        const { authority, published } = harness();
        authority.onLinePainted(1, painted());
        authority.onLinePainted(1, painted(TEXT, 'hi my good friend'));
        await flush();
        expect(published).toHaveLength(1);

        authority.toggle(intent(0, 'hola'));
        authority.onLinePainted(1, painted(TEXT, 'hello my good friend'));
        authority.onLinePainted(1, painted(TEXT, 'x'.repeat(1001)));
        await flush();
        expect(published.slice(1)).toMatchObject([
            { reason: 'toggle', line: line('hi my good friend') },
            {
                reason: 'translation',
                selectionRevision: 3,
                entries: [{ wordIndex: 0, word: 'hola' }],
                line: line('hello my good friend'),
            },
            { reason: 'translation', selectionRevision: 4, line: line() },
        ]);
    });

    it('acknowledges a republish only after the exact replay is accepted', async () => {
        const { authority, published } = harness();
        expect(await authority.handleRepublish(5)).toEqual({
            requestId: 5,
            result: 'empty',
        });
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(await authority.handleRepublish(6)).toEqual({
            requestId: 6,
            result: 'replayed',
        });
        expect(published.at(-1)).toMatchObject({ selectionRevision: 2 });
        expect(published).toHaveLength(3);
    });

    it('follows the selection when a newer snapshot overtakes the replay', async () => {
        const { authority, published, hold, release } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        hold();
        const pending = authority.handleRepublish(1);
        authority.toggle(intent(1, 'mi'));
        release();
        expect(await pending).toEqual({ requestId: 1, result: 'replayed' });
        // The overtaking snapshot went out on its own, then again as the
        // replay the ack stands for.
        expect(published.slice(-2)).toMatchObject([
            {
                selectionRevision: 3,
                entries: [
                    { wordIndex: 0, word: 'hola' },
                    { wordIndex: 1, word: 'mi' },
                ],
            },
            { selectionRevision: 3 },
        ]);
    });

    it('removes one exact occurrence only after the successor snapshot is accepted', async () => {
        const { authority, published, shown } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        authority.toggle(intent(2, 'buen'));
        await flush();
        const result = await authority.handleEdit(
            edit({ selectionRevision: 3, wordIndex: 2 })
        );
        expect(result).toEqual({ success: true, requestId: 9 });
        expect(published.at(-1)).toEqual({
            lifecycleGeneration: 7,
            selectionRevision: 4,
            renderRevision: 1,
            reason: 'remove',
            entries: [{ wordIndex: 0, word: 'hola' }],
            line: line(),
        });
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(shown.at(-1)).toEqual([0]);
    });

    it('adds a word of the line, spelled as the line has it', async () => {
        const { authority, published, shown } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(
            await authority.handleEdit(edit({ op: 'add', wordIndex: 3 }))
        ).toEqual({ success: true, requestId: 9 });
        expect(published.at(-1)).toEqual({
            lifecycleGeneration: 7,
            selectionRevision: 3,
            renderRevision: 1,
            reason: 'add',
            entries: [
                { wordIndex: 0, word: 'hola' },
                { wordIndex: 3, word: 'amigo' },
            ],
            line: line(),
        });
        expect(shown.at(-1)).toEqual([0, 3]);
    });

    it('keeps the line after the last word goes, so a word can come back', async () => {
        const { authority, published } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        await authority.handleEdit(edit());
        expect(published.at(-1)).toMatchObject({
            reason: 'remove',
            entries: [],
            line: line(),
        });
        expect(
            await authority.handleEdit(
                edit({ op: 'add', selectionRevision: 3, wordIndex: 1 })
            )
        ).toEqual({ success: true, requestId: 9 });
        void authority.handleEdit(edit({ op: 'remove' }));
        authority.onLinePainted(2, painted());
        await flush();
        expect(published.at(-1)).toMatchObject({
            reason: 'subtitle-change',
            line: null,
        });
    });

    it('rejects an edit that does not match the current snapshot without publishing', async () => {
        const { authority, published } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        for (const command of [
            edit({ lifecycleGeneration: 6 }),
            edit({ selectionRevision: 1 }),
            edit({ renderRevision: 2 }),
            edit({ wordIndex: 1 }),
            edit({ op: 'add' }),
            edit({ op: 'add', wordIndex: 4 }),
        ]) {
            expect(await authority.handleEdit(command)).toEqual({
                success: false,
                requestId: 9,
            });
        }
        expect(published).toHaveLength(2);
        expect(authority.selectedIndices).toEqual(new Set([0]));
    });

    it('keeps the occurrence and publishes a repair when the successor is rejected', async () => {
        const { authority, published } = harness({
            accept: (snapshot) => snapshot.reason !== 'remove',
        });
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(await authority.handleEdit(edit({ requestId: 2 }))).toEqual({
            success: false,
            requestId: 2,
        });
        await flush();
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(published.at(-1)).toMatchObject({
            selectionRevision: 4,
            reason: 'restore',
            entries: [{ wordIndex: 0, word: 'hola' }],
            line: line(),
        });
    });

    it('holds a translation back while an edit is in flight, then sends it', async () => {
        const { authority, published, hold, release } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        hold();
        const pending = authority.handleEdit(edit({ op: 'add', wordIndex: 1 }));
        authority.onLinePainted(1, painted(TEXT, 'hello my good friend'));
        release();
        expect(await pending).toEqual({ success: true, requestId: 9 });
        await flush();
        expect(published.slice(-2)).toMatchObject([
            { reason: 'add', selectionRevision: 3, line: line() },
            {
                reason: 'translation',
                selectionRevision: 4,
                entries: [
                    { wordIndex: 0, word: 'hola' },
                    { wordIndex: 1, word: 'mi' },
                ],
                line: line('hello my good friend'),
            },
        ]);
    });

    it('rejects an edit overtaken by a subtitle change and refuses toggles meanwhile', async () => {
        const { authority, hold, release, published } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        await flush();
        hold();
        const pending = authority.handleEdit(edit({ requestId: 3 }));
        expect(authority.toggle(intent(1, 'mi'))).toBeNull();
        authority.onLinePainted(2, painted());
        release();
        expect(await pending).toEqual({ success: false, requestId: 3 });
        await flush();
        expect(published.at(-1)).toMatchObject({
            reason: 'subtitle-change',
            renderRevision: 2,
        });
        expect(authority.toggle(intent(1, 'mi', 2))).toBe('added');
    });

    it('publishes an empty snapshot without a line when cleared', async () => {
        const { authority, published } = harness();
        authority.onLinePainted(1, painted());
        authority.toggle(intent(0, 'hola'));
        authority.clear();
        await flush();
        expect(published.at(-1)).toMatchObject({
            selectionRevision: 3,
            reason: 'clear',
            entries: [],
            line: null,
        });
        expect(authority.selectedIndices.size).toBe(0);
    });

    it('reports a publication the background refused as failed, not empty', async () => {
        const { authority } = harness({ accept: () => false });
        authority.onLinePainted(1, painted());
        await flush();
        expect(await authority.handleRepublish(1)).toEqual({
            requestId: 1,
            result: 'failed',
        });
    });

    it('treats a failed publication as not accepted', async () => {
        const { authority, publish } = harness();
        publish.mockRejectedValueOnce(new Error('offline'));
        authority.onLinePainted(1, painted());
        await flush();
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(await authority.handleRepublish(1)).toEqual({
            requestId: 1,
            result: 'replayed',
        });
    });
});
