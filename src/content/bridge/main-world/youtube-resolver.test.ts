// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedEvent } from '../protocol';

// The recipe captures window timers at module evaluation, so fake timers
// must be installed before the module loads.
vi.useFakeTimers();
const { youtubeRecipe } = await import('./youtube-recipe');

const VIDEO = 'arj7oStGLkU';
const NEXT_VIDEO = 'Ks-_Mh1QhMc';

interface FakeTrack {
    readonly languageCode: string;
    readonly asr?: true;
    readonly isDefault?: true;
    /** The player has not signed this track yet. */
    readonly unsigned?: true;
}

const EN: FakeTrack = { languageCode: 'en' };
const EN_ASR: FakeTrack = { languageCode: 'en', asr: true };
const ZH: FakeTrack = { languageCode: 'zh-Hans' };
const FR: FakeTrack = { languageCode: 'fr' };

/** The experiment YouTube names on caption URLs it serves only signed. */
type Experiment = 'xpe' | 'xpv' | null;

/** The track's URL as the player holds it; `pot` arrives once signed. */
function playerUrl(
    videoId: string,
    track: FakeTrack,
    signed: boolean,
    experiment: Experiment
): string {
    const url = new URL('https://www.youtube.com/api/timedtext');
    url.searchParams.set('v', videoId);
    if (experiment) {
        url.searchParams.set('exp', experiment);
    }
    url.searchParams.set('lang', track.languageCode);
    if (track.asr) {
        url.searchParams.set('kind', 'asr');
    }
    if (signed) {
        url.searchParams.set('potc', '1');
        url.searchParams.set('pot', 'token');
    }
    return url.href;
}

/** The URL the recipe should send for a track, signed unless said not. */
function sentUrl(
    videoId: string,
    track: FakeTrack,
    signed = true,
    experiment: Experiment = 'xpe'
): string {
    const url = new URL(playerUrl(videoId, track, signed, experiment));
    url.searchParams.set('c', 'WEB');
    url.searchParams.set('fmt', 'vtt');
    return url.href;
}

interface PlayerState {
    videoId: string;
    tracks: FakeTrack[];
    signed: boolean;
    experiment: Experiment;
    visible: boolean;
    audioId: string;
    /** The tracks' own URLs name this video, which lags on a transition. */
    trackVideoId?: string;
}

function installPlayer(
    id: 'movie_player' | 'shorts-player',
    initial: Partial<PlayerState> = {}
) {
    const state: PlayerState = {
        videoId: VIDEO,
        tracks: [EN],
        signed: true,
        experiment: 'xpe',
        visible: true,
        audioId: 'und',
        ...initial,
    };
    const player = document.createElement('div');
    player.id = id;
    const video = document.createElement('video');
    video.className = 'video-stream html5-main-video';
    video.getBoundingClientRect = () =>
        ({
            width: state.visible ? 960 : 0,
            height: state.visible ? 540 : 0,
        }) as DOMRect;
    player.append(video);
    document.body.append(player);
    Object.assign(player, {
        getPlayerResponse: () => ({
            videoDetails: { videoId: state.videoId },
            ...(state.tracks.length > 0
                ? {
                      captions: {
                          playerCaptionsTracklistRenderer: {
                              captionTracks: state.tracks.map((track) => ({
                                  languageCode: track.languageCode,
                              })),
                          },
                      },
                  }
                : {}),
        }),
        getAudioTrack: () => ({
            id: state.audioId,
            captionTracks: state.tracks.map((track) => ({
                languageCode: track.languageCode,
                languageName: track.languageCode,
                displayName: `${track.languageCode}${track.asr ? ' (auto-generated)' : ''}`,
                kind: track.asr ? 'asr' : '',
                vssId: `${track.asr ? 'a' : ''}.${track.languageCode}`,
                isDefault: track.isDefault === true,
                url: playerUrl(
                    state.trackVideoId ?? state.videoId,
                    track,
                    state.signed && !track.unsigned,
                    state.experiment
                ),
            })),
        }),
    });
    return {
        set(next: Partial<PlayerState>): void {
            Object.assign(state, next);
        },
    };
}

const emitted: CapturedEvent[] = [];
const emit = (event: CapturedEvent): void => {
    emitted.push(event);
};

function request(languages: string[], videoId = VIDEO): void {
    youtubeRecipe.onControl?.(
        { t: 'request-subtitle-tracks', videoId, languages },
        emit
    );
}

function sentTracks(): unknown {
    const event = emitted.at(-1);
    return event?.t === 'subtitle-data' ? event.tracks : undefined;
}

async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
    emitted.length = 0;
    (globalThis as { ytcfg?: unknown }).ytcfg = {
        get: (key: string) =>
            key === 'INNERTUBE_CLIENT_NAME' ? 'WEB' : undefined,
    };
});

afterEach(() => {
    youtubeRecipe.onClose?.();
    document.body.replaceChildren();
    delete (globalThis as { ytcfg?: unknown }).ytcfg;
});

describe('youtubeRecipe track resolution', () => {
    it('sends only the requested languages, preferring captions a person wrote', async () => {
        installPlayer('movie_player', {
            tracks: [FR, EN_ASR, EN, ZH, { languageCode: 'de' }],
        });
        request(['en', 'zh-CN']);
        await settle();
        expect(emitted).toEqual([
            {
                t: 'subtitle-data',
                platform: 'youtube',
                videoId: VIDEO,
                languages: ['en', 'zh-CN'],
                tracks: [
                    {
                        language: 'en',
                        displayName: 'en',
                        asr: false,
                        url: sentUrl(VIDEO, EN),
                    },
                    {
                        language: 'zh-Hans',
                        displayName: 'zh-Hans',
                        asr: false,
                        url: sentUrl(VIDEO, ZH),
                    },
                ],
            },
        ]);
    });

    it.each(['xpe', 'xpv'] as const)(
        'waits for the signature on tracks YouTube marks %s, without turning captions on',
        async (experiment) => {
            const page = installPlayer('movie_player', {
                signed: false,
                experiment,
            });
            request(['en']);
            await settle(10_000);
            expect(emitted).toEqual([]);

            page.set({ signed: true });
            await settle(250);
            expect(emitted).toHaveLength(1);
            expect(sentTracks()).toEqual([
                {
                    language: 'en',
                    displayName: 'en',
                    asr: false,
                    url: sentUrl(VIDEO, EN, true, experiment),
                },
            ]);
        }
    );

    it('sends unmarked tracks at once, unsigned, and again once the player signs them', async () => {
        const page = installPlayer('movie_player', {
            signed: false,
            experiment: null,
            tracks: [EN, ZH],
        });
        request(['en', 'zh-CN']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, false, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, ZH, false, null) }),
        ]);

        page.set({ signed: true });
        await settle(250);
        expect(emitted).toHaveLength(2);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, true, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, ZH, true, null) }),
        ]);
    });

    it('sends again each time the player signs more, the original before its translation', async () => {
        const zh: FakeTrack = { languageCode: 'zh-Hans', unsigned: true };
        const page = installPlayer('movie_player', {
            signed: false,
            experiment: null,
            tracks: [EN, zh],
        });
        request(['en', 'zh-CN']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, false, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, zh, false, null) }),
        ]);

        page.set({ signed: true });
        await settle(250);
        expect(emitted).toHaveLength(2);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, true, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, zh, false, null) }),
        ]);

        page.set({ tracks: [EN, ZH] });
        await settle(250);
        expect(emitted).toHaveLength(3);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, true, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, ZH, true, null) }),
        ]);

        await settle(61_000);
        expect(emitted).toHaveLength(3);
    });

    it('sends a signed original at once with an unmarked translation not yet signed', async () => {
        const zh: FakeTrack = { languageCode: 'zh-Hans', unsigned: true };
        installPlayer('movie_player', { experiment: null, tracks: [EN, zh] });
        request(['en', 'zh-CN']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN, true, null) }),
            expect.objectContaining({ url: sentUrl(VIDEO, zh, false, null) }),
        ]);

        await settle(61_000);
        expect(emitted).toHaveLength(1);
    });

    it('sends a signed original at once, and its marked translation once signed', async () => {
        const page = installPlayer('movie_player', {
            tracks: [EN, { languageCode: 'zh-Hans', unsigned: true }],
        });
        request(['en', 'zh-CN']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN) }),
        ]);

        page.set({ tracks: [EN, ZH] });
        await settle(250);
        expect(emitted).toHaveLength(2);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(VIDEO, EN) }),
            expect.objectContaining({ url: sentUrl(VIDEO, ZH) }),
        ]);
    });

    it('keeps the signed original when its marked translation is never signed', async () => {
        installPlayer('movie_player', {
            tracks: [EN, { languageCode: 'zh-Hans', unsigned: true }],
        });
        request(['en', 'zh-CN']);
        await settle(61_000);
        expect(emitted).toHaveLength(1);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ language: 'en' }),
        ]);
    });

    it('answers none at the deadline when YouTube never signs tracks it marks', async () => {
        installPlayer('movie_player', { signed: false });
        request(['en']);
        await settle(59_000);
        expect(emitted).toEqual([]);

        await settle(1500);
        expect(sentTracks()).toEqual([]);
    });

    it('waits while the route names a video the player has not loaded yet', async () => {
        const page = installPlayer('movie_player');
        request(['en'], NEXT_VIDEO);
        await settle(2000);
        expect(emitted).toEqual([]);

        // The response moves first; its tracks still belong to the old video.
        page.set({ videoId: NEXT_VIDEO, trackVideoId: VIDEO });
        await settle(2000);
        expect(emitted).toEqual([]);

        page.set({ trackVideoId: NEXT_VIDEO });
        await settle(250);
        expect(sentTracks()).toEqual([
            expect.objectContaining({ url: sentUrl(NEXT_VIDEO, EN) }),
        ]);
    });

    it('answers from the player on screen, not a hidden preload player', async () => {
        installPlayer('movie_player', { visible: false, tracks: [FR] });
        installPlayer('shorts-player', { tracks: [EN_ASR] });
        request(['en']);
        await settle();
        expect(sentTracks()).toEqual([
            {
                language: 'en',
                displayName: 'en (auto-generated)',
                asr: true,
                url: sentUrl(VIDEO, EN_ASR),
            },
        ]);
    });

    it('says at once that a video without captions has none', async () => {
        installPlayer('movie_player', { tracks: [] });
        request(['en']);
        await settle();
        expect(sentTracks()).toEqual([]);
    });

    it('never sends speech recognition as a translation', async () => {
        installPlayer('movie_player', {
            tracks: [EN, { languageCode: 'zh-Hans', asr: true }],
        });
        request(['en', 'zh-CN']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ language: 'en' }),
        ]);
    });

    it('falls back to English, then the first track, for a missing original', async () => {
        const page = installPlayer('movie_player', { tracks: [FR, EN_ASR] });
        request(['sv']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ language: 'en', asr: true }),
        ]);

        page.set({ tracks: [FR] });
        request(['sv']);
        await settle();
        expect(sentTracks()).toEqual([
            expect.objectContaining({ language: 'fr' }),
        ]);
    });

    it('answers with no tracks when no player holds the video within the wait budget', async () => {
        installPlayer('movie_player', { videoId: NEXT_VIDEO });
        request(['en']);
        await settle(59_000);
        expect(emitted).toEqual([]);
        await settle(1500);
        expect(sentTracks()).toEqual([]);
    });

    it('is superseded by a newer request and dropped by a cancel', async () => {
        const page = installPlayer('movie_player', { signed: false });
        request(['en']);
        request(['en', 'zh-CN']);
        page.set({ tracks: [EN, ZH], signed: true });
        await settle(250);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({ languages: ['en', 'zh-CN'] });

        page.set({ signed: false });
        request(['en']);
        youtubeRecipe.onControl?.({ t: 'cancel-subtitle-tracks' }, emit);
        page.set({ signed: true });
        await settle(1000);
        expect(emitted).toHaveLength(1);
    });
});

describe('youtubeRecipe spoken language', () => {
    function watch(videoId = VIDEO): void {
        youtubeRecipe.onControl?.(
            { t: 'watch-spoken-language', videoId },
            emit
        );
    }

    function spoken(): unknown[] {
        return emitted
            .filter((event) => event.t === 'spoken-language')
            .map((event) => (event as { language: unknown }).language);
    }

    it('takes the audio track’s language when the player knows it', async () => {
        installPlayer('movie_player', { audioId: 'es-419', tracks: [EN_ASR] });
        watch();
        await settle();
        expect(emitted).toEqual([
            {
                t: 'spoken-language',
                platform: 'youtube',
                videoId: VIDEO,
                language: 'es-419',
            },
        ]);
    });

    it('takes the one speech-recognition track’s language when the audio is undetermined', async () => {
        installPlayer('movie_player', {
            tracks: [EN, { languageCode: 'ja', asr: true }],
        });
        watch();
        await settle();
        expect(spoken()).toEqual(['ja']);
    });

    it('takes the default caption track’s language next', async () => {
        installPlayer('movie_player', {
            tracks: [
                EN_ASR,
                { languageCode: 'ja', asr: true },
                { languageCode: 'de', isDefault: true },
            ],
        });
        watch();
        await settle();
        expect(spoken()).toEqual(['de']);
    });

    it('says at once that it cannot tell when the loaded captions name no language', async () => {
        installPlayer('movie_player', { tracks: [EN, FR] });
        watch();
        await settle();
        expect(spoken()).toEqual([null]);
    });

    it('says at once that it cannot tell for a video without captions', async () => {
        installPlayer('movie_player', { tracks: [] });
        watch();
        await settle();
        expect(spoken()).toEqual([null]);
    });

    it('waits while the player is still loading the listed captions', async () => {
        const page = installPlayer('movie_player', {
            tracks: [EN_ASR],
            trackVideoId: NEXT_VIDEO,
        });
        watch();
        await settle(5000);
        expect(spoken()).toEqual([]);

        page.set({ trackVideoId: VIDEO });
        await settle(1000);
        expect(spoken()).toEqual(['en']);
    });

    it('reports nothing for a video no player on screen holds', async () => {
        installPlayer('movie_player', { audioId: 'en' });
        watch(NEXT_VIDEO);
        await settle(5000);
        expect(spoken()).toEqual([]);
    });
});
