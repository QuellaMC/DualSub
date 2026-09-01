// Disney+ renders its player controls inside nested open shadow roots. These
// helpers locate the timeline slider and the play/pause toggle through them.

const TIMELINE_SELECTORS = [
    '.progress-bar__seekable-range[role="slider"][aria-valuenow]',
    '.progress-bar__seekable-range[aria-valuenow]',
    '[role="slider"][aria-label="Timeline"][aria-valuenow]',
    '[role="slider"][aria-valuenow][aria-valuemax]',
    '.progress-bar__thumb[aria-valuenow][aria-valuemax]',
];
const DEEP_SEARCH_INTERVAL_MS = 1000;

/** Breadth-first querySelector across every open shadow root. */
export function querySelectorDeep(
    selectors: string | readonly string[],
    accept?: (candidate: Element) => boolean
): Element | null {
    const selectorList =
        typeof selectors === 'string' ? [selectors] : selectors;
    const visited = new Set<ParentNode>();
    const queue: ParentNode[] = [document];

    while (queue.length > 0) {
        const root = queue.shift()!;
        if (visited.has(root)) {
            continue;
        }
        visited.add(root);

        for (const selector of selectorList) {
            try {
                if (accept) {
                    for (const candidate of root.querySelectorAll(selector)) {
                        if (accept(candidate)) {
                            return candidate;
                        }
                    }
                } else {
                    const element = root.querySelector(selector);
                    if (element) {
                        return element;
                    }
                }
            } catch {
                // An invalid selector for this root type is skipped.
            }
        }
        for (const node of root.querySelectorAll('*')) {
            if (node.shadowRoot) {
                queue.push(node.shadowRoot);
            }
        }
    }
    return null;
}

function findTimelineInProgressHosts(
    progressHosts: Iterable<Element>
): Element | null {
    let bestTimeline: Element | null = null;
    let bestMaximum = -Infinity;
    for (const host of progressHosts) {
        const shadow = host.shadowRoot;
        if (!shadow) {
            continue;
        }
        let timeline: Element | null = null;
        for (const selector of TIMELINE_SELECTORS) {
            timeline = shadow.querySelector(selector);
            if (timeline) {
                break;
            }
        }
        if (!timeline) {
            continue;
        }
        const maximum = Number.parseFloat(
            timeline.getAttribute('aria-valuemax') ?? '0'
        );
        if (
            !bestTimeline ||
            (Number.isFinite(maximum) && maximum > bestMaximum)
        ) {
            bestTimeline = timeline;
            bestMaximum = Number.isFinite(maximum) ? maximum : bestMaximum;
        }
    }
    return bestTimeline;
}

/**
 * Finds the timeline slider: controls overlay → progress-bar (both shadow
 * hosts), then light-DOM progress-bar, then a rate-limited deep search. The
 * result is cached while connected.
 */
export class TimelineLocator {
    private cached: Element | null = null;
    private lastDeepSearchAt = 0;

    locate(): Element | null {
        if (this.cached?.isConnected) {
            return this.cached;
        }
        this.cached = null;

        for (const overlay of document.querySelectorAll(
            'main-app-controls-overlay'
        )) {
            const hosts = overlay.shadowRoot?.querySelectorAll('progress-bar');
            const timeline = hosts ? findTimelineInProgressHosts(hosts) : null;
            if (timeline) {
                this.cached = timeline;
                return timeline;
            }
        }

        const lightDomTimeline = findTimelineInProgressHosts(
            document.querySelectorAll('progress-bar')
        );
        if (lightDomTimeline) {
            this.cached = lightDomTimeline;
            return lightDomTimeline;
        }

        const now = Date.now();
        if (now - this.lastDeepSearchAt < DEEP_SEARCH_INTERVAL_MS) {
            return null;
        }
        this.lastDeepSearchAt = now;

        const deepHost = querySelectorDeep('progress-bar');
        const deepTimeline = deepHost
            ? findTimelineInProgressHosts([deepHost])
            : null;
        if (deepTimeline) {
            this.cached = deepTimeline;
            return deepTimeline;
        }
        this.cached = querySelectorDeep([
            TIMELINE_SELECTORS[0]!,
            TIMELINE_SELECTORS[2]!,
        ]);
        return this.cached;
    }

    reset(): void {
        this.cached = null;
    }
}

export function readTimelineTime(timeline: Element | null): number | null {
    const value = Number.parseFloat(
        timeline?.getAttribute('aria-valuenow') ?? 'NaN'
    );
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function actionableButton(root: ParentNode | null): HTMLElement | null {
    if (!root) {
        return null;
    }
    for (const selector of ['button', '[role="button"]']) {
        for (const candidate of root.querySelectorAll(selector)) {
            if (
                candidate.isConnected &&
                (candidate as HTMLButtonElement).disabled !== true &&
                candidate.getAttribute('aria-disabled') !== 'true' &&
                candidate instanceof HTMLElement
            ) {
                return candidate;
            }
        }
    }
    return null;
}

/** The play/pause toggle inside `toggle-play-pause`'s shadow root. */
export function findPlayPauseButton(): HTMLElement | null {
    const isActionableHost = (candidate: Element): boolean =>
        candidate.isConnected &&
        actionableButton(candidate.shadowRoot) !== null;
    const direct = document.querySelector(
        'disney-web-player-ui toggle-play-pause'
    );
    const host =
        direct && isActionableHost(direct)
            ? direct
            : querySelectorDeep('toggle-play-pause', isActionableHost);
    return actionableButton(host?.shadowRoot ?? null);
}
