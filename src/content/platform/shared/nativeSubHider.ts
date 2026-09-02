import type { Logger } from '@/shared/logger';
import type { configService } from '@/config/service';
import type { MediaScope, NativeSubRecipe } from '../types';
import { scopedTimeout } from '../../orchestrator/scope';

const ROOT_RETRY_DELAY_MS = 250;
const MAX_ROOT_RETRIES = 20;
const REAPPLY_DELAY_MS = 100;
const HIDDEN_ATTRIBUTE = 'data-dualsub-hidden';

type ConfigSource = Pick<typeof configService, 'get' | 'onChanged'>;

type StyleRoot = Document | ShadowRoot;

/** The tree a stylesheet must live in to reach `element`: the document or
 *  the shadow root the element is rendered in. Decided by node type so it
 *  holds across realms. */
function styleRootOf(element: Element): StyleRoot | null {
    const root = element.getRootNode();
    if (root.nodeType === Node.DOCUMENT_NODE) {
        return root as Document;
    }
    return root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root
        ? (root as ShadowRoot)
        : null;
}

function styleHostOf(root: StyleRoot): ParentNode | null {
    return root.nodeType === Node.DOCUMENT_NODE
        ? (root as Document).head
        : root;
}

/** Every element matching the selectors under `scopes`, looking through
 *  each open shadow root on the way down. */
function collectTargets(
    scopes: readonly ParentNode[],
    selectors: readonly string[]
): Element[] {
    const found = new Set<Element>();
    const visited = new Set<ParentNode>();
    const queue = [...scopes];
    while (queue.length > 0) {
        const root = queue.shift()!;
        if (visited.has(root)) {
            continue;
        }
        visited.add(root);
        for (const selector of selectors) {
            for (const element of root.querySelectorAll(selector)) {
                found.add(element);
            }
        }
        for (const node of root.querySelectorAll('*')) {
            if (node.shadowRoot) {
                queue.push(node.shadowRoot);
            }
        }
    }
    return [...found];
}

/**
 * Hides the platform's own subtitle rendering while DualSub is showing
 * subtitles. Targets are marked with `data-dualsub-hidden`; a stylesheet
 * keyed on that attribute does the hiding and is placed in whichever tree
 * holds the target, so cues rendered inside open shadow roots are covered
 * too. Observers re-apply after the site re-renders its cue containers.
 * Fully reversible: abort restores everything.
 */
export function installNativeSubHider(
    recipe: NativeSubRecipe,
    media: MediaScope,
    deps: { signal: AbortSignal; config: ConfigSource; logger: Logger }
): void {
    const { signal } = deps;
    if (signal.aborted) {
        return;
    }

    let hide = false;
    const marked = new Set<Element>();
    const styledRoots = new Set<StyleRoot>();
    const observedRoots = new Set<Node>();
    const observers: MutationObserver[] = [];
    let reapplyScheduled = false;
    let reportedNoTargets = false;

    const ensureStyle = (root: StyleRoot): void => {
        if (styledRoots.has(root)) {
            return;
        }
        const host = styleHostOf(root);
        if (!host) {
            return;
        }
        if (!root.querySelector(`#${recipe.styleId}`)) {
            const style = document.createElement('style');
            style.id = recipe.styleId;
            style.textContent = recipe.css;
            host.appendChild(style);
        }
        styledRoots.add(root);
    };

    const scheduleReapply = (): void => {
        if (reapplyScheduled) {
            return;
        }
        reapplyScheduled = true;
        scopedTimeout(
            signal,
            () => {
                reapplyScheduled = false;
                apply();
            },
            REAPPLY_DELAY_MS
        );
    };

    const observe = (root: Node): void => {
        if (observedRoots.has(root) || !root.isConnected) {
            return;
        }
        observedRoots.add(root);
        const observer = new MutationObserver((mutations) => {
            if (mutations.some((m) => m.addedNodes.length > 0)) {
                scheduleReapply();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
        observers.push(observer);
    };

    const apply = (): void => {
        if (signal.aborted) {
            return;
        }
        const targets = collectTargets(
            [document, ...recipe.observedRoots(media)],
            recipe.selectors
        );
        if (hide && targets.length === 0 && !reportedNoTargets) {
            reportedNoTargets = true;
            deps.logger.info('No native subtitle container found to hide yet');
        }
        for (const element of targets) {
            if (hide) {
                const root = styleRootOf(element);
                if (root) {
                    ensureStyle(root);
                    observe(root);
                }
                element.setAttribute(HIDDEN_ATTRIBUTE, 'true');
                marked.add(element);
            } else {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
        }
        if (!hide) {
            for (const element of marked) {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
            marked.clear();
        }
    };

    void deps.config.get('hideOfficialSubtitles').then((value) => {
        hide = value;
        apply();
    });
    const unsubscribe = deps.config.onChanged((changes) => {
        if (changes.hideOfficialSubtitles !== undefined) {
            hide = changes.hideOfficialSubtitles;
            apply();
        }
    });

    // The recipe's roots are watched from the start; roots discovered
    // through targets (a cue tree inside a shadow root) join as they appear.
    const watchRecipeRoots = (attempt: number): void => {
        if (signal.aborted) {
            return;
        }
        const roots = recipe
            .observedRoots(media)
            .filter((root) => root.isConnected);
        if (roots.length === 0) {
            if (attempt < MAX_ROOT_RETRIES) {
                scopedTimeout(
                    signal,
                    () => watchRecipeRoots(attempt + 1),
                    ROOT_RETRY_DELAY_MS
                );
            }
            return;
        }
        for (const root of roots) {
            observe(root);
        }
    };
    watchRecipeRoots(0);

    signal.addEventListener(
        'abort',
        () => {
            unsubscribe();
            for (const observer of observers) {
                observer.disconnect();
            }
            for (const element of marked) {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
            marked.clear();
        },
        { once: true }
    );
}
