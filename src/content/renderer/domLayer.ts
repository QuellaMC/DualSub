import type { MediaScope } from '../platform/types';
import { createSubtitleElements, type SubtitleElements } from './styling';

/**
 * Document-scoped host for every DualSub overlay: a fixed, full-viewport,
 * click-transparent layer. Created at document_start (before <body>) under
 * <html> and moved to <body> when it appears; re-parented into the
 * fullscreen element so overlays survive fullscreen mode.
 */
export class UiRoot {
    private element: HTMLDivElement | null = null;

    constructor(private readonly signal: AbortSignal) {
        document.addEventListener('fullscreenchange', () => this.reparent(), {
            signal,
        });
        if (!document.body) {
            document.addEventListener(
                'DOMContentLoaded',
                () => this.reparent(),
                {
                    once: true,
                    signal,
                }
            );
        }
        signal.addEventListener(
            'abort',
            () => {
                this.element?.remove();
                this.element = null;
            },
            { once: true }
        );
    }

    ensure(): HTMLDivElement {
        if (this.element?.isConnected) {
            return this.element;
        }
        const root = this.element ?? document.createElement('div');
        root.id = 'dualsub-ui-root';
        Object.assign(root.style, {
            pointerEvents: 'none',
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            zIndex: '9999',
        });
        this.element = root;
        this.reparent();
        return root;
    }

    private reparent(): void {
        if (!this.element || this.signal.aborted) {
            return;
        }
        const host =
            document.fullscreenElement ??
            document.body ??
            document.documentElement;
        if (this.element.parentElement !== host) {
            host.appendChild(this.element);
        }
    }
}

/** Session-scoped subtitle container living inside the UiRoot. */
export class SessionContainer {
    private elements: SubtitleElements | null = null;
    private epoch = 0;

    constructor(private readonly uiRoot: UiRoot) {}

    /** Bumps whenever the container is (re)built, for frame-memo invalidation. */
    get containerEpoch(): number {
        return this.epoch;
    }

    /** Returns live elements, rebuilding if the site tore the container out. */
    ensure(media: MediaScope | null): SubtitleElements {
        const root = this.uiRoot.ensure();
        if (this.elements?.container.isConnected) {
            if (this.elements.container.parentElement !== root) {
                root.appendChild(this.elements.container);
            }
            return this.elements;
        }
        this.elements?.container.remove();
        this.elements = createSubtitleElements();
        root.appendChild(this.elements.container);
        this.epoch += 1;

        // Overlay positioning is relative to the player when it is not.
        if (media?.root && getComputedStyle(media.root).position === 'static') {
            media.root.style.position = 'relative';
        }
        return this.elements;
    }

    get current(): SubtitleElements | null {
        return this.elements;
    }

    destroy(): void {
        this.elements?.container.remove();
        this.elements = null;
    }
}
