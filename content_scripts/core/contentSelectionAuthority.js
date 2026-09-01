import { AI_CONTEXT_SIGNAL_TYPES } from '../aicontext/core/AIContextChannel.js';
import { SelectionModel } from '../aicontext/core/state/SelectionModel.js';
import { sendRuntimeMessageWithRetry } from '../shared/messaging.js';
import {
    buildSidePanelContentSelectionSnapshotMessage,
    parseSidePanelContentSelectionSnapshotResponse,
} from '../shared/protocol/messageProtocol.js';

let nextLifecycleGeneration = 0;
let nextAnalysisRequestId = 0;

function nextSafeInteger(value) {
    return value < Number.MAX_SAFE_INTEGER ? value + 1 : null;
}

export function initializeContentSelectionAuthority(contentScript) {
    const lifecycleGeneration = nextSafeInteger(nextLifecycleGeneration);
    if (lifecycleGeneration !== null) {
        nextLifecycleGeneration = lifecycleGeneration;
    }
    contentScript._contentSelectionAuthority = {
        lifecycleGeneration,
        lastAllocatedSelectionRevision: 0,
        currentRenderRevision: null,
        selectionModel: new SelectionModel(),
        snapshot: null,
        publicationTail: Promise.resolve(false),
        publisherCleanup: null,
        publisherInstallationGeneration: 0,
        pendingRemoval: null,
        terminal: lifecycleGeneration === null,
    };
}

export function getContentSelectionAuthorityState(contentScript) {
    return contentScript._contentSelectionAuthority ?? null;
}

export function allocateContentSelectionRevision(state) {
    if (!state || state.terminal) return null;
    const revision = nextSafeInteger(state.lastAllocatedSelectionRevision);
    if (revision !== null) state.lastAllocatedSelectionRevision = revision;
    return revision;
}

export function allocateAnalysisRequestId() {
    const requestId = nextSafeInteger(nextAnalysisRequestId);
    if (requestId !== null) nextAnalysisRequestId = requestId;
    return requestId;
}

export function createCanonicalContentSelectionSnapshot(
    state,
    selectionRevision,
    renderRevision,
    reason,
    entries
) {
    try {
        const { data } = buildSidePanelContentSelectionSnapshotMessage({
            lifecycleGeneration: state.lifecycleGeneration,
            selectionRevision,
            renderRevision,
            reason,
            entries,
        });
        return Object.freeze({
            selectionRevision: data.selectionRevision,
            renderRevision: data.renderRevision,
            reason: data.reason,
            entries: data.entries,
        });
    } catch {
        return null;
    }
}

export function queueContentSelectionSnapshot(
    contentScript,
    snapshot,
    canDispatch = () => true
) {
    const state = getContentSelectionAuthorityState(contentScript);
    if (!state || state.terminal || !snapshot) return Promise.resolve(false);

    const publication = state.publicationTail.then(async () => {
        if (state.terminal || !canDispatch()) return false;
        try {
            const message = buildSidePanelContentSelectionSnapshotMessage({
                lifecycleGeneration: state.lifecycleGeneration,
                selectionRevision: snapshot.selectionRevision,
                renderRevision: snapshot.renderRevision,
                reason: snapshot.reason,
                entries: snapshot.entries,
            });
            const response = await sendRuntimeMessageWithRetry(message, {
                retries: 2,
                baseDelayMs: 120,
                canDispatch: () => !state.terminal && canDispatch(),
            });
            return (
                parseSidePanelContentSelectionSnapshotResponse(response)
                    ?.status === 'accepted'
            );
        } catch {
            return false;
        }
    });
    state.publicationTail = publication.then(
        () => false,
        () => false
    );
    return publication;
}

export function clearContentSelectionHighlights() {
    document
        .querySelectorAll('.dualsub-interactive-word.dualsub-word-selected')
        .forEach((element) =>
            element.classList.remove('dualsub-word-selected')
        );
}

export function publishSelectionSnapshotToOwner(owner, snapshot) {
    if (!owner?.active || !snapshot) return 0;
    return owner.channel.publish(
        AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
        snapshot
    );
}

export function endContentSelectionAuthority(contentScript) {
    const state = getContentSelectionAuthorityState(contentScript);
    if (!state || state.terminal) return;
    state.terminal = true;
    state.pendingRemoval = null;
    state.publisherInstallationGeneration += 1;
    const cleanup = state.publisherCleanup;
    state.publisherCleanup = null;
    try {
        cleanup?.();
    } catch {}
}
