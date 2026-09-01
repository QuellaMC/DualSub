import type { Logger } from '@/shared/logger';
import type { configService } from '@/config/service';
import type { MediaScope, NativeSubRecipe } from '../types';
import { scopedTimeout } from '../../orchestrator/scope';

const ROOT_RETRY_DELAY_MS = 250;
const MAX_ROOT_RETRIES = 20;
const REAPPLY_DELAY_MS = 100;
const HIDDEN_ATTRIBUTE = 'data-dualsub-hidden';

type ConfigSource = Pick<typeof configService, 'get' | 'onChanged'>;

/**
 * Hides the platform's own subtitle rendering while DualSub is showing
 * subtitles. A stylesheet keyed on `data-dualsub-hidden` does the hiding;
 * an observer re-applies after the site re-renders its cue containers. Fully
 * reversible: abort restores everything.
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

    if (!document.getElementById(recipe.styleId) && document.head) {
        const style = document.createElement('style');
        style.id = recipe.styleId;
        style.textContent = recipe.css;
        document.head.appendChild(style);
    }

    let hide = false;

    const targets = (): Element[] => {
        const found = new Set<Element>();
        const roots: ParentNode[] = [document, ...recipe.observedRoots(media)];
        for (const root of roots) {
            for (const selector of recipe.selectors) {
                for (const element of root.querySelectorAll(selector)) {
                    found.add(element);
                }
            }
        }
        return [...found];
    };

    const apply = (): void => {
        if (signal.aborted) {
            return;
        }
        for (const element of targets()) {
            if (hide) {
                element.setAttribute(HIDDEN_ATTRIBUTE, 'true');
            } else {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
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

    const observers: MutationObserver[] = [];
    const observe = (attempt: number): void => {
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
                    () => observe(attempt + 1),
                    ROOT_RETRY_DELAY_MS
                );
            }
            return;
        }
        let reapplyScheduled = false;
        const observer = new MutationObserver((mutations) => {
            if (
                reapplyScheduled ||
                !mutations.some((m) => m.addedNodes.length > 0)
            ) {
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
        });
        for (const root of roots) {
            observer.observe(root, { childList: true, subtree: true });
        }
        observers.push(observer);
    };
    observe(0);

    signal.addEventListener(
        'abort',
        () => {
            unsubscribe();
            for (const observer of observers) {
                observer.disconnect();
            }
            for (const element of document.querySelectorAll(
                `[${HIDDEN_ATTRIBUTE}]`
            )) {
                element.removeAttribute(HIDDEN_ATTRIBUTE);
            }
        },
        { once: true }
    );
}
