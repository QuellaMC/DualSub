import { describe, expect, it, vi } from 'vitest';
import type { ContentSelectionSnapshot } from '@/messaging/contracts/selection';
import {
    allocateLifecycleGeneration,
    SelectionAuthority,
} from './SelectionAuthority';

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

describe('SelectionAuthority', () => {
    it('allocates distinct monotonic lifecycle generations', () => {
        const first = allocateLifecycleGeneration();
        expect(allocateLifecycleGeneration()).toBe(first + 1);
    });

    it('publishes the first line, then only lines that clear something', async () => {
        const { authority, published } = harness();
        authority.onSubtitleChange(1);
        authority.onSubtitleChange(2);
        await flush();
        expect(published).toEqual([
            {
                lifecycleGeneration: 7,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'subtitle-change',
                entries: [],
            },
        ]);
        expect(authority.toggle(intent(0, 'hola', 2))).toBe('added');
        authority.onSubtitleChange(3);
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
        });
    });

    it('ignores stale or repeated render revisions', () => {
        const { authority, shown } = harness();
        authority.onSubtitleChange(2);
        authority.toggle(intent(0, 'a', 2));
        authority.onSubtitleChange(1);
        authority.onSubtitleChange(2);
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(shown.at(-1)).toEqual([0]);
    });

    it('toggles words of the current line in sentence order and shows them', async () => {
        const { authority, published, shown } = harness();
        authority.onSubtitleChange(1);
        expect(authority.toggle(intent(3, 'amigo'))).toBe('added');
        expect(authority.toggle(intent(0, 'hola'))).toBe('added');
        expect(authority.toggle(intent(3, 'amigo'))).toBe('removed');
        expect(authority.toggle(intent(0, 'hola', 2))).toBeNull();
        expect(authority.toggle(intent(0, ''))).toBeNull();
        await flush();
        expect(published.slice(1)).toMatchObject([
            {
                selectionRevision: 2,
                reason: 'toggle',
                entries: [{ wordIndex: 3, word: 'amigo' }],
            },
            {
                selectionRevision: 3,
                reason: 'toggle',
                entries: [
                    { wordIndex: 0, word: 'hola' },
                    { wordIndex: 3, word: 'amigo' },
                ],
            },
            {
                selectionRevision: 4,
                reason: 'toggle',
                entries: [{ wordIndex: 0, word: 'hola' }],
            },
        ]);
        expect(shown).toEqual([[], [3], [0, 3], [0]]);
    });

    it('acknowledges a republish only after the exact replay is accepted', async () => {
        const { authority, published } = harness();
        expect(await authority.handleRepublish(5)).toEqual({
            requestId: 5,
            accepted: false,
        });
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(await authority.handleRepublish(6)).toEqual({
            requestId: 6,
            accepted: true,
        });
        expect(published.at(-1)).toMatchObject({ selectionRevision: 2 });
        expect(published).toHaveLength(3);
    });

    it('does not acknowledge a replay that a newer snapshot overtook', async () => {
        const { authority, hold, release } = harness();
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        await flush();
        hold();
        const pending = authority.handleRepublish(1);
        authority.toggle(intent(1, 'amigo'));
        release();
        expect(await pending).toEqual({ requestId: 1, accepted: false });
    });

    it('removes one exact occurrence only after the successor snapshot is accepted', async () => {
        const { authority, published, shown } = harness();
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        authority.toggle(intent(2, 'amigo'));
        await flush();
        const result = await authority.handleRemoval({
            requestId: 9,
            lifecycleGeneration: 7,
            selectionRevision: 3,
            renderRevision: 1,
            wordIndex: 2,
        });
        expect(result).toEqual({ success: true, requestId: 9 });
        expect(published.at(-1)).toEqual({
            lifecycleGeneration: 7,
            selectionRevision: 4,
            renderRevision: 1,
            reason: 'remove',
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(shown.at(-1)).toEqual([0]);
    });

    it('rejects a removal that does not match the current snapshot without publishing', async () => {
        const { authority, published } = harness();
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        await flush();
        const base = {
            requestId: 1,
            lifecycleGeneration: 7,
            selectionRevision: 2,
            renderRevision: 1,
            wordIndex: 0,
        };
        for (const command of [
            { ...base, lifecycleGeneration: 6 },
            { ...base, selectionRevision: 1 },
            { ...base, renderRevision: 2 },
            { ...base, wordIndex: 1 },
        ]) {
            expect(await authority.handleRemoval(command)).toEqual({
                success: false,
                requestId: 1,
            });
        }
        expect(published).toHaveLength(2);
        expect(authority.selectedIndices).toEqual(new Set([0]));
    });

    it('keeps the occurrence and publishes a repair when the successor is rejected', async () => {
        const { authority, published } = harness({
            accept: (snapshot) => snapshot.reason !== 'remove',
        });
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(
            await authority.handleRemoval({
                requestId: 2,
                lifecycleGeneration: 7,
                selectionRevision: 2,
                renderRevision: 1,
                wordIndex: 0,
            })
        ).toEqual({ success: false, requestId: 2 });
        await flush();
        expect(authority.selectedIndices).toEqual(new Set([0]));
        expect(published.at(-1)).toMatchObject({
            selectionRevision: 4,
            reason: 'restore',
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
    });

    it('rejects a removal overtaken by a subtitle change and refuses toggles meanwhile', async () => {
        const { authority, hold, release, published } = harness();
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        await flush();
        hold();
        const pending = authority.handleRemoval({
            requestId: 3,
            lifecycleGeneration: 7,
            selectionRevision: 2,
            renderRevision: 1,
            wordIndex: 0,
        });
        expect(authority.toggle(intent(1, 'amigo'))).toBeNull();
        authority.onSubtitleChange(2);
        release();
        expect(await pending).toEqual({ success: false, requestId: 3 });
        await flush();
        expect(published.at(-1)).toMatchObject({
            reason: 'subtitle-change',
            renderRevision: 2,
        });
        expect(authority.toggle(intent(1, 'amigo', 2))).toBe('added');
    });

    it('publishes an empty snapshot when cleared', async () => {
        const { authority, published } = harness();
        authority.onSubtitleChange(1);
        authority.toggle(intent(0, 'hola'));
        authority.clear();
        await flush();
        expect(published.at(-1)).toMatchObject({
            selectionRevision: 3,
            reason: 'clear',
            entries: [],
        });
        expect(authority.selectedIndices.size).toBe(0);
    });

    it('treats a failed publication as not accepted', async () => {
        const { authority, publish } = harness();
        publish.mockRejectedValueOnce(new Error('offline'));
        authority.onSubtitleChange(1);
        await flush();
        authority.toggle(intent(0, 'hola'));
        await flush();
        expect(await authority.handleRepublish(1)).toEqual({
            requestId: 1,
            accepted: true,
        });
    });
});
