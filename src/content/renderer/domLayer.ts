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

function createStage(): HTMLDivElement {
    const stage = document.createElement('div');
    stage.id = 'dualsub-subtitle-stage';
    Object.assign(stage.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
    });
    return stage;
}

/** Session-scoped stage inside the UiRoot: a box laid over the picture
 *  that holds the subtitle blocks. */
export class SessionContainer {
    private stage: HTMLDivElement | null = null;
    private epoch = 0;

    constructor(private readonly uiRoot: UiRoot) {}

    /** Bumps whenever the stage is (re)built, for frame-memo invalidation. */
    get containerEpoch(): number {
        return this.epoch;
    }

    /** The live stage, rebuilt empty if the site tore it out. */
    ensure(): HTMLDivElement {
        const root = this.uiRoot.ensure();
        if (this.stage?.isConnected) {
            if (this.stage.parentElement !== root) {
                root.appendChild(this.stage);
            }
            return this.stage;
        }
        this.stage?.remove();
        this.stage = createStage();
        root.appendChild(this.stage);
        this.epoch += 1;
        return this.stage;
    }

    get current(): HTMLDivElement | null {
        return this.stage;
    }

    destroy(): void {
        this.stage?.remove();
        this.stage = null;
    }
}
