// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsChanges } from '@/config/service';
import type { MediaScope, NativeSubRecipe } from '../types';
import { installNativeSubHider } from './nativeSubHider';

const recipe: NativeSubRecipe = {
    styleId: 'dualsub-test-hider',
    selectors: ['.cue', 'timed-text-region'],
    css: `.cue[data-dualsub-hidden="true"], timed-text-region[data-dualsub-hidden="true"] { display: none !important; }`,
    observedRoots(media) {
        return media.root ? [media.root] : [];
    },
};

const silentLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** Every install of a test is torn down with it, as a session would. */
const installs: AbortController[] = [];

function harness(hideOfficialSubtitles: boolean) {
    let listener: ((changes: SettingsChanges) => unknown) | null = null;
    const config = {
        get: vi.fn(() => Promise.resolve(hideOfficialSubtitles)),
        onChanged: vi.fn((callback: (changes: SettingsChanges) => unknown) => {
            listener = callback;
            return () => {
                listener = null;
            };
        }),
    };
    const player = document.createElement('div');
    document.body.append(player);
    const video = document.createElement('video');
    player.append(video);
    const controller = new AbortController();
    installs.push(controller);
    const media: MediaScope = { root: player, video };
    return {
        player,
        media,
        controller,
        start: () => {
            installNativeSubHider(recipe, media, {
                signal: controller.signal,
                config: config as never,
                logger: silentLogger,
            });
        },
        emit: (changes: SettingsChanges) => {
            listener?.(changes);
        },
    };
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(150);
}

function hidden(element: Element): boolean {
    return element.getAttribute('data-dualsub-hidden') === 'true';
}

describe('installNativeSubHider', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    });

    afterEach(() => {
        for (const controller of installs.splice(0)) {
            controller.abort();
        }
        vi.useRealTimers();
    });

    it('marks light-DOM cues and installs the stylesheet in the document', async () => {
        const { player, start } = harness(true);
        const cue = document.createElement('div');
        cue.className = 'cue';
        player.append(cue);
        start();
        await settle();
        expect(hidden(cue)).toBe(true);
        expect(
            document.head.querySelector('#dualsub-test-hider')
        ).not.toBeNull();
    });

    it('reaches cues rendered inside an open shadow root and styles that root', async () => {
        const { player, start } = harness(true);
        const host = document.createElement('div');
        player.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const inner = document.createElement('div');
        const region = document.createElement('timed-text-region');
        inner.attachShadow({ mode: 'open' }).append(region);
        shadow.append(inner);
        start();
        await settle();
        expect(hidden(region)).toBe(true);
        expect(
            inner.shadowRoot!.querySelector('#dualsub-test-hider')
        ).not.toBeNull();
        expect(document.head.querySelector('#dualsub-test-hider')).toBeNull();
    });

    it('re-applies when the site re-renders cues inside a shadow root', async () => {
        const { player, start } = harness(true);
        const host = document.createElement('div');
        player.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const first = document.createElement('div');
        first.className = 'cue';
        shadow.append(first);
        start();
        await settle();
        expect(hidden(first)).toBe(true);

        first.remove();
        const second = document.createElement('div');
        second.className = 'cue';
        shadow.append(second);
        await settle();
        expect(hidden(second)).toBe(true);
    });

    it('follows the setting both ways and restores everything on abort', async () => {
        const { player, start, emit, controller } = harness(false);
        const cue = document.createElement('div');
        cue.className = 'cue';
        player.append(cue);
        start();
        await settle();
        expect(hidden(cue)).toBe(false);

        emit({ hideOfficialSubtitles: true });
        expect(hidden(cue)).toBe(true);
        emit({ hideOfficialSubtitles: false });
        expect(hidden(cue)).toBe(false);

        emit({ hideOfficialSubtitles: true });
        expect(hidden(cue)).toBe(true);
        controller.abort();
        expect(hidden(cue)).toBe(false);
        const late = document.createElement('div');
        late.className = 'cue';
        player.append(late);
        await settle();
        expect(hidden(late)).toBe(false);
    });
});
