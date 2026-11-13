import {
    contentSelectionSnapshot,
    lineTranslation,
    type ContentSelectionSnapshot,
    type SelectionEditOp,
    type SelectionEntry,
    type SelectionLine,
    type SelectionReason,
    type SelectionRepublishResult,
} from '@/messaging/contracts/selection';
import { lineWords } from '@/shared/words';
import type { PaintedLine } from '../renderer/Renderer';
import type { WordIntent } from '../renderer/wordLayer';

let nextLifecycleGeneration = 0;

/** Monotonic across every session in this document, so the background
 *  can order owners even when sessions restart. */
export function allocateLifecycleGeneration(): number {
    nextLifecycleGeneration += 1;
    return nextLifecycleGeneration;
}

export interface EditCommand {
    readonly requestId: number;
    readonly lifecycleGeneration: number;
    readonly selectionRevision: number;
    readonly renderRevision: number;
    readonly wordIndex: number;
    readonly op: SelectionEditOp;
}

export interface SelectionAuthorityDeps {
    readonly lifecycleGeneration: number;
    /** Deliver a snapshot to the background; resolves to its acceptance. */
    readonly publish: (
        snapshot: ContentSelectionSnapshot,
        canDispatch: () => boolean
    ) => Promise<boolean>;
    /** Show the selected word indices of the current line. */
    readonly onSelectionChanged: (indices: ReadonlySet<number>) => void;
}

interface PendingEdit {
    readonly command: EditCommand;
    readonly current: ContentSelectionSnapshot;
    readonly successor: ContentSelectionSnapshot;
}

/** The line as a selection carries it; a blank line carries nothing, and a
 *  translation too long to send is left out. */
function selectionLineOf(painted: PaintedLine): SelectionLine | null {
    if (painted.text.trim() === '') {
        return null;
    }
    const translation =
        painted.translation !== null &&
        lineTranslation.safeParse(painted.translation).success
            ? painted.translation
            : null;
    return { text: painted.text, language: painted.language, translation };
}

function entriesOf(selected: ReadonlyMap<number, string>): SelectionEntry[] {
    return [...selected.entries()]
        .sort(([left], [right]) => left - right)
        .map(([wordIndex, word]) => ({ wordIndex, word }));
}

/**
 * The single source of truth for which words are selected. Every change
 * becomes a numbered snapshot published to the background; the side panel
 * only ever mirrors these. A panel-requested edit is applied only after
 * its successor snapshot was accepted, so the panel cannot show a state
 * the background has not seen.
 */
export class SelectionAuthority {
    private readonly selected = new Map<number, string>();
    private selectionRevision = 0;
    private renderRevision: number | null = null;
    /** The line now painted, with its latest translation. */
    private line: SelectionLine | null = null;
    private snapshot: ContentSelectionSnapshot | null = null;
    private publicationTail: Promise<boolean> = Promise.resolve(false);
    private pendingEdit: PendingEdit | null = null;
    private queuedOnce = false;

    constructor(private readonly deps: SelectionAuthorityDeps) {}

    get selectedIndices(): ReadonlySet<number> {
        return new Set(this.selected.keys());
    }

    /**
     * A line was painted. A new revision is a new line: the selection
     * belongs to the old one and is dropped. The first line and any line
     * that clears something are published so a panel never keeps a stale
     * selection; empty-to-empty transitions stay local. The same revision
     * again carries a new translation of the same line.
     */
    onLinePainted(renderRevision: number, painted: PaintedLine): void {
        if (
            this.renderRevision !== null &&
            renderRevision < this.renderRevision
        ) {
            return;
        }
        const line = selectionLineOf(painted);
        if (renderRevision === this.renderRevision) {
            this.line = line;
            this.publishTranslation();
            return;
        }
        const hadSomething =
            this.selected.size > 0 ||
            this.pendingEdit !== null ||
            (this.snapshot?.line ?? null) !== null;
        this.pendingEdit = null;
        this.selected.clear();
        this.renderRevision = renderRevision;
        this.line = line;
        this.deps.onSelectionChanged(this.selectedIndices);
        const snapshot = this.commit('subtitle-change', renderRevision);
        if (hadSomething || !this.queuedOnce) {
            void this.queue(snapshot);
        }
    }

    /** A click on a word of the current line. Null when it cannot apply,
     *  including when the selection would outgrow what a snapshot holds. */
    toggle(intent: WordIntent): 'added' | 'removed' | null {
        if (
            this.pendingEdit ||
            this.renderRevision === null ||
            intent.renderRevision !== this.renderRevision ||
            intent.word === ''
        ) {
            return null;
        }
        const result = this.selected.has(intent.wordIndex)
            ? 'removed'
            : 'added';
        const selected = new Map(this.selected);
        if (result === 'added') {
            selected.set(intent.wordIndex, intent.word);
        } else {
            selected.delete(intent.wordIndex);
        }
        const snapshot = this.next(
            'toggle',
            intent.renderRevision,
            entriesOf(selected),
            this.line
        );
        if (!contentSelectionSnapshot.safeParse(snapshot).success) {
            return null;
        }
        if (result === 'added') {
            this.selected.set(intent.wordIndex, intent.word);
        } else {
            this.selected.delete(intent.wordIndex);
        }
        this.adopt(snapshot);
        this.deps.onSelectionChanged(this.selectedIndices);
        void this.queue(snapshot);
        return result;
    }

    /** Drop everything and say so (word lookup was switched off). */
    clear(): void {
        if (this.renderRevision === null) {
            return;
        }
        this.pendingEdit = null;
        this.selected.clear();
        this.deps.onSelectionChanged(this.selectedIndices);
        void this.queue(this.commit('clear', this.renderRevision));
    }

    /** Background asks for the current snapshot again. "replayed" means
     *  the snapshot that is current here has been accepted there, following
     *  the selection through any change that overtakes a replay; "empty"
     *  that there is nothing to publish; "failed" that publishing it did not
     *  go through, which says nothing about what the background holds. */
    async handleRepublish(
        requestId: number
    ): Promise<{ requestId: number; result: SelectionRepublishResult }> {
        for (;;) {
            const snapshot = this.snapshot;
            if (!snapshot) {
                return { requestId, result: 'empty' };
            }
            const accepted = await this.queue(
                snapshot,
                () => this.snapshot === snapshot
            );
            if (this.snapshot === snapshot) {
                return { requestId, result: accepted ? 'replayed' : 'failed' };
            }
        }
    }

    /**
     * Phase two of a panel edit: publish the successor first, apply it
     * locally only once accepted, and repair with a fresh snapshot when the
     * world moved underneath the flight. An added word's text comes from
     * the line as painted here, never from the panel.
     */
    async handleEdit(
        command: EditCommand
    ): Promise<{ success: boolean; requestId: number }> {
        const current = this.snapshot;
        const reject = { success: false, requestId: command.requestId };
        const removing = command.op === 'remove';
        if (
            this.pendingEdit ||
            !current?.line ||
            command.lifecycleGeneration !== this.deps.lifecycleGeneration ||
            command.selectionRevision !== current.selectionRevision ||
            command.renderRevision !== current.renderRevision ||
            this.renderRevision !== current.renderRevision ||
            this.selected.has(command.wordIndex) !== removing
        ) {
            return reject;
        }
        const added = removing
            ? undefined
            : lineWords(current.line)[command.wordIndex]?.word;
        if (!removing && added === undefined) {
            return reject;
        }
        const selected = new Map(this.selected);
        if (added === undefined) {
            selected.delete(command.wordIndex);
        } else {
            selected.set(command.wordIndex, added);
        }
        const successor = this.next(
            command.op,
            current.renderRevision,
            entriesOf(selected),
            current.line
        );
        if (!contentSelectionSnapshot.safeParse(successor).success) {
            return reject;
        }
        this.selectionRevision = successor.selectionRevision;
        const pending: PendingEdit = { command, current, successor };
        this.pendingEdit = pending;

        const accepted = await this.queue(
            successor,
            () => this.pendingEdit === pending && this.snapshot === current
        );
        if (this.pendingEdit !== pending) {
            return reject;
        }
        this.pendingEdit = null;
        if (
            !accepted ||
            this.snapshot !== current ||
            this.renderRevision !== current.renderRevision ||
            this.selected.has(command.wordIndex) !== removing
        ) {
            if (this.snapshot === current) {
                this.repair();
            }
            this.publishTranslation();
            return reject;
        }
        if (added === undefined) {
            this.selected.delete(command.wordIndex);
        } else {
            this.selected.set(command.wordIndex, added);
        }
        this.snapshot = successor;
        this.deps.onSelectionChanged(this.selectedIndices);
        this.publishTranslation();
        return { success: true, requestId: command.requestId };
    }

    /** The background may have accepted a successor that never applied;
     *  a higher-revision snapshot of the real state wins over it. */
    private repair(): void {
        const renderRevision = this.snapshot?.renderRevision;
        if (renderRevision === undefined) {
            return;
        }
        void this.queue(
            this.commit(
                this.selected.size > 0 ? 'restore' : 'clear',
                renderRevision
            )
        );
    }

    /** Send a translation that reached the current line after its snapshot.
     *  An edit in flight keeps its snapshot as it was; the translation goes
     *  out once the edit settles. */
    private publishTranslation(): void {
        const current = this.snapshot;
        if (
            this.pendingEdit ||
            !current?.line ||
            !this.line ||
            current.line.translation === this.line.translation
        ) {
            return;
        }
        void this.queue(this.commit('translation', current.renderRevision));
    }

    /** The snapshot one revision on, not yet current. */
    private next(
        reason: SelectionReason,
        renderRevision: number,
        entries: SelectionEntry[],
        line: SelectionLine | null
    ): ContentSelectionSnapshot {
        return {
            lifecycleGeneration: this.deps.lifecycleGeneration,
            selectionRevision: this.selectionRevision + 1,
            renderRevision,
            reason,
            entries,
            line,
        };
    }

    private adopt(snapshot: ContentSelectionSnapshot): void {
        this.selectionRevision = snapshot.selectionRevision;
        this.snapshot = snapshot;
    }

    /** Allocate the next revision and make its snapshot current. A new
     *  line or a cleared selection carries no line. */
    private commit(
        reason: SelectionReason,
        renderRevision: number
    ): ContentSelectionSnapshot {
        const snapshot = this.next(
            reason,
            renderRevision,
            entriesOf(this.selected),
            reason === 'clear' || reason === 'subtitle-change'
                ? null
                : this.line
        );
        this.adopt(snapshot);
        return snapshot;
    }

    /** Publications leave in order; each may be withdrawn before dispatch. */
    private queue(
        snapshot: ContentSelectionSnapshot,
        canDispatch: () => boolean = () => true
    ): Promise<boolean> {
        this.queuedOnce = true;
        const run = this.publicationTail.then(async () => {
            if (!canDispatch()) {
                return false;
            }
            try {
                return await this.deps.publish(snapshot, canDispatch);
            } catch {
                return false;
            }
        });
        this.publicationTail = run.then(
            () => false,
            () => false
        );
        return run;
    }
}
