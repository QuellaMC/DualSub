// @vitest-environment happy-dom
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { configService } from '@/config/service';
import { setUrl } from '@/test-utils/dom';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { netflixDescriptor } from '../platform/netflix/descriptor';
import { ContentOrchestrator } from './ContentOrchestrator';

const popupSender = {
    id: TEST_EXTENSION_ID,
    url: `${TEST_EXTENSION_ORIGIN}/popup.html`,
};

/** A Netflix player: its video, and one of the site's own cues. */
function addPlayer(): { root: HTMLElement; cue: HTMLElement } {
    const root = document.createElement('div');
    root.className = 'watch-video';
    const cue = document.createElement('div');
    cue.className = 'player-timedtext';
    root.append(document.createElement('video'), cue);
    document.body.append(root);
    return { root, cue };
}

async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
}

interface PlayerAnswer {
    readonly onPlayer: boolean;
    readonly topLanguage: string | null;
}

/** What the tab tells the popup about its player. */
async function playerAnswer(): Promise<PlayerAnswer> {
    const answers: PlayerAnswer[] = [];
    void (await fakeBrowser.runtime.onMessage.trigger(
        { action: 'playerStatus' },
        popupSender,
        (answer: PlayerAnswer) => {
            answers.push(answer);
        }
    ));
    await settle();
    return answers[0]!;
}

async function onPlayer(): Promise<boolean> {
    return (await playerAnswer()).onPlayer;
}

let orchestrator: ContentOrchestrator | null = null;

function start(): void {
    orchestrator = new ContentOrchestrator(netflixDescriptor);
    orchestrator.start();
}

beforeAll(() => {
    installExtensionRuntimeIdentity();
});

beforeEach(async () => {
    vi.useFakeTimers();
    // A torn-down orchestrator's router would still answer.
    fakeBrowser.runtime.onMessage.removeAllListeners();
    document.body.innerHTML = '';
    setUrl('https://www.netflix.com/watch/1');
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
});

afterEach(() => {
    orchestrator?.teardown('document-teardown');
    orchestrator = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('ContentOrchestrator', () => {
    it('starts a session with a setting changed while its settings were read', async () => {
        const { cue } = addPlayer();
        const read = configService.getMultiple.bind(configService);
        const held = Promise.withResolvers<void>();
        vi.spyOn(configService, 'getMultiple').mockImplementation(
            async (keys, options) => {
                const values = await read(keys, options);
                if (keys.includes('hideOfficialSubtitles')) {
                    await held.promise;
                }
                return values;
            }
        );
        start();
        await settle();
        await fakeBrowser.storage.sync.set({ hideOfficialSubtitles: false });
        await settle();

        held.resolve();
        await settle();
        expect(await onPlayer()).toBe(true);
        expect(cue.getAttribute('data-dualsub-hidden')).toBeNull();
    });

    it('tells the popup it is on a player only while its video is bound', async () => {
        start();
        await settle();
        expect(await onPlayer()).toBe(false);

        const { root } = addPlayer();
        await settle(1000);
        expect(await onPlayer()).toBe(true);

        root.remove();
        await settle(1000);
        expect(await onPlayer()).toBe(false);
    });

    it('tells the popup the language its top line shows, once known', async () => {
        await fakeBrowser.storage.sync.set({ originalLanguage: 'ko' });
        start();
        await settle();
        expect(await playerAnswer()).toEqual({
            onPlayer: false,
            topLanguage: null,
        });

        addPlayer();
        await settle(1000);
        expect(await playerAnswer()).toEqual({
            onPlayer: true,
            topLanguage: 'ko',
        });
    });
});
