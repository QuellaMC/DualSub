/**
 * Transitions - class-only visual transitions (no state changes)
 *
 * Adds/removes CSS classes to drive visibility and processing transitions.
 */
export class Transitions {
    static showContainer(container) {
        if (!container) return;
        container.classList.add('dualsub-context-modal--visible');
    }

    static hideContainer(container) {
        if (!container) return;
        container.classList.remove('dualsub-context-modal--visible');
    }

    static showOverlay(overlay) {
        if (!overlay) return;
        overlay.classList.add('dualsub-visible');
        try {
            overlay.style.display = 'block';
            overlay.style.pointerEvents = 'auto';
        } catch (_) {}
    }

    static hideOverlay(overlay) {
        if (!overlay) return;
        overlay.classList.remove('dualsub-visible');
        try {
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
        } catch (_) {}
    }

    static showContent(content) {
        if (!content) return;
        content.classList.add('dualsub-visible');
        try {
            content.style.display = 'block';
        } catch (_) {}
    }

    static hideContent(content) {
        if (!content) return;
        content.classList.remove('dualsub-visible');
        try {
            content.style.display = 'none';
        } catch (_) {}
    }

    static markProcessing(content, enable) {
        if (!content) return;
        if (enable) content.classList.add('dualsub-processing-active');
        else content.classList.remove('dualsub-processing-active');
    }
}
