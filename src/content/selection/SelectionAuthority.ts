import type {
    ContentSelectionSnapshot,
    SelectionEntry,
    SelectionReason,
} from '@/messaging/contracts/selection';
import type { WordIntent } from '../renderer/wordLayer';

let nextLifecycleGeneration = 0;

/** Monotonic across every session in this document, so the background
 *  can order owners even when sessions restart. */
export function allocateLifecycleGeneration(): number {
    nextLifecycleGeneration += 1;
    return nextLifecycleGeneration;
}

export interface RemovalCommand {
    readonly requestId: number;
    readonly lifecycleGeneration: number;
    readonly selectionRevision: number;
    readonly renderRevision: number;
    readonly wordIndex: number;
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

interface PendingRemoval {
    readonly command: RemovalCommand;
    readonly current: ContentSelectionSnapshot;
    readonly successor: ContentSelectionSnapshot;
}

/**
 * The single source of truth for which words are selected. Every change
 * becomes a numbered snapshot published to the background; the side panel
 * only ever mirrors these. A panel-requested removal is applied only after
 * its successor snapshot was accepted, so the panel cannot show a state
 * the background has not seen.
 */
export class SelectionAuthority {
    private readonly selected = new Map<number, string>();
    private selectionRevision = 0;
    private renderRevision: number | null = null;
    private snapshot: ContentSelectionSnapshot | null = null;
    private publicationTail: Promise<boolean> = Promise.resolve(false);
    private pendingRemoval: PendingRemoval | null = null;
    private queuedOnce = false;

    constructor(private readonly deps: SelectionAuthorityDeps) {}

    get selectedIndices(): ReadonlySet<number> {
        return new Set(this.selected.keys());
    }

    /**
     * A new line was painted. The selection belongs to the old line and is
     * dropped. The first line and any line that clears something are
     * published so a panel never keeps a stale selection; empty-to-empty
     * transitions stay local.
     */
    onSubtitleChange(renderRevision: number): void {
        if (
            this.renderRevision !== null &&
            renderRevision <= this.renderRevision
        ) {
            return;
        }
        const hadSomething =
            this.selected.size > 0 || this.pendingRemoval !== null;
        this.pendingRemoval = null;
        this.selected.clear();
        this.renderRevision = renderRevision;
        this.deps.onSelectionChanged(this.selectedIndices);
        const snapshot = this.commit('subtitle-change', renderRevision);
        if (hadSomething || !this.queuedOnce) {
            void this.queue(snapshot);
        }
    }

    /** A click on a word of the current line. Null when it cannot apply. */
    toggle(intent: WordIntent): 'added' | 'removed' | null {
        if (
            this.pendingRemoval ||
            this.renderRevision === null ||
            intent.renderRevision !== this.renderRevision ||
            intent.word === ''
        ) {
            return null;
        }
        const result = this.selected.has(intent.wordIndex)
            ? 'removed'
            : 'added';
        if (result === 'added') {
            this.selected.set(intent.wordIndex, intent.word);
        } else {
            this.selected.delete(intent.wordIndex);
        }
        this.deps.onSelectionChanged(this.selectedIndices);
        void this.queue(this.commit('toggle', intent.renderRevision));
        return result;
    }

    /** Drop everything and say so (the feature was switched off). */
    clear(): void {
        if (this.renderRevision === null) {
            return;
        }
        this.pendingRemoval = null;
        this.selected.clear();
        this.deps.onSelectionChanged(this.selectedIndices);
        void this.queue(this.commit('clear', this.renderRevision));
    }

    /** Background asks for the current snapshot again. The ack is true once
     *  the snapshot that is current here has been accepted there, following
     *  the selection through any change that overtakes a replay; it is false
     *  only when there is nothing to publish or the background refused it. */
    async handleRepublish(
        requestId: number
    ): Promise<{ requestId: number; accepted: boolean }> {
        for (;;) {
            const snapshot = this.snapshot;
            if (!snapshot) {
                return { requestId, accepted: false };
            }
            const accepted = await this.queue(
                snapshot,
                () => this.snapshot === snapshot
            );
            if (this.snapshot === snapshot) {
                return { requestId, accepted };
            }
        }
    }

    /**
     * Phase two of a panel removal: publish the successor first, apply it
     * locally only once accepted, and repair with a fresh snapshot when the
     * world moved underneath the flight.
     */
    async handleRemoval(
        command: RemovalCommand
    ): Promise<{ success: boolean; requestId: number }> {
        const current = this.snapshot;
        const reject = { success: false, requestId: command.requestId };
        if (
            this.pendingRemoval ||
            !current ||
            command.lifecycleGeneration !== this.deps.lifecycleGeneration ||
            command.selectionRevision !== current.selectionRevision ||
            command.renderRevision !== current.renderRevision ||
            this.renderRevision !== current.renderRevision ||
            !this.selected.has(command.wordIndex)
        ) {
            return reject;
        }
        this.selectionRevision += 1;
        const successor: ContentSelectionSnapshot = {
            lifecycleGeneration: this.deps.lifecycleGeneration,
            selectionRevision: this.selectionRevision,
            renderRevision: current.renderRevision,
            reason: 'remove',
            entries: current.entries.filter(
                (entry) => entry.wordIndex !== command.wordIndex
            ),
        };
        const pending: PendingRemoval = { command, current, successor };
        this.pendingRemoval = pending;

        const accepted = await this.queue(
            successor,
            () => this.pendingRemoval === pending && this.snapshot === current
        );
        if (this.pendingRemoval !== pending) {
            return reject;
        }
        this.pendingRemoval = null;
        if (
            !accepted ||
            this.snapshot !== current ||
            this.renderRevision !== current.renderRevision ||
            !this.selected.has(command.wordIndex)
        ) {
            if (this.snapshot === current) {
                this.repair();
            }
            return reject;
        }
        this.selected.delete(command.wordIndex);
        this.snapshot = successor;
        this.deps.onSelectionChanged(this.selectedIndices);
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

    private entries(): SelectionEntry[] {
        return [...this.selected.entries()]
            .sort(([left], [right]) => left - right)
            .map(([wordIndex, word]) => ({ wordIndex, word }));
    }

    /** Allocate the next revision and make its snapshot current. */
    private commit(
        reason: SelectionReason,
        renderRevision: number
    ): ContentSelectionSnapshot {
        this.selectionRevision += 1;
        const snapshot: ContentSelectionSnapshot = {
            lifecycleGeneration: this.deps.lifecycleGeneration,
            selectionRevision: this.selectionRevision,
            renderRevision,
            reason,
            entries: this.entries(),
        };
        this.snapshot = snapshot;
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
