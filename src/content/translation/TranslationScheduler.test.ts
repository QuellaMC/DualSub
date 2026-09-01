import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TranslateResponse } from '@/messaging/contracts/translate';
import type { Cue } from '../subtitles/cueModel';
import {
    MAX_CUES_PER_PASS,
    TranslationScheduler,
    selectCuesToTranslate,
} from './TranslationScheduler';

const silentLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

function cue(
    id: string,
    start: number,
    end: number,
    overrides: Partial<Cue> = {}
): Cue {
    return {
        id,
        start,
        end,
        cueType: 'original',
        original: `text ${id}`,
        translated: null,
        useNativeTarget: false,
        ...overrides,
    };
}

function ok(text: string): TranslateResponse {
    return {
        success: true,
        translatedText: `T:${text}`,
        cached: false,
        processingTime: 1,
    };
}

const failure = (
    retryable: boolean,
    retryAfter: number | null = null
): TranslateResponse => ({
    success: false,
    retryable,
    retryAfter,
});

function setup(
    cues: Cue[],
    options: {
        time?: number | null;
        respond?: (text: string, call: number) => Promise<TranslateResponse>;
    } = {}
) {
    const controller = new AbortController();
    const clock = { time: options.time === undefined ? 0 : options.time };
    let calls = 0;
    const send = vi.fn((request: { text: string }) => {
        calls += 1;
        return options.respond
            ? options.respond(request.text, calls)
            : Promise.resolve(ok(request.text));
    });
    const onTranslated = vi.fn();
    const scheduler = new TranslationScheduler({
        cues,
        videoId: 'v1',
        targetLanguage: 'zh-CN',
        currentTime: () => clock.time,
        send,
        onTranslated,
        signal: controller.signal,
        logger: silentLogger,
    });
    return { scheduler, controller, clock, send, onTranslated };
}

/** Timers plus the microtask chain a pass runs on. */
async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
        (key: string) => (key === 'translationApiError' ? '[API]' : '[REQUEST]')
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('selectCuesToTranslate', () => {
    it('orders on-screen cues first, then upcoming, then just-passed', () => {
        const cues = [
            cue('past', 0, 2),
            cue('active', 3, 5),
            cue('soon', 10, 12),
            cue('later', 20, 22),
        ];
        expect(
            selectCuesToTranslate(cues, 4, Date.now(), new Map(), 10).map(
                (c) => c.id
            )
        ).toEqual(['active', 'soon', 'later', 'past']);
    });

    it('keeps only pending original cues inside the window', () => {
        const cues = [
            cue('tooOld', 0, 4),
            cue('recent', 0, 5),
            cue('translated', 12, 13, { translated: 'done' }),
            cue('native', 14, 15, { useNativeTarget: true }),
            cue('target', 14, 15, {
                cueType: 'target',
                original: null,
                translated: 'x',
            }),
            cue('blank', 16, 17, { original: '   ' }),
            cue('edge', 40, 41),
            cue('tooFar', 40.5, 42),
        ];
        expect(
            selectCuesToTranslate(cues, 10, Date.now(), new Map(), 10).map(
                (c) => c.id
            )
        ).toEqual(['edge', 'recent']);
    });

    it('skips cues whose deferral has not elapsed', () => {
        const pending = cue('pending', 1, 2);
        const deferrals = new Map([
            [
                'pending',
                {
                    cue: pending as Cue & { original: string },
                    count: 1,
                    retryAt: 1000,
                },
            ],
        ]);
        expect(selectCuesToTranslate([pending], 1, 999, deferrals, 10)).toEqual(
            []
        );
        expect(
            selectCuesToTranslate([pending], 1, 1000, deferrals, 10)
        ).toHaveLength(1);
    });
});

describe('TranslationScheduler', () => {
    it('translates a few cues per pass, one request at a time, and continues', async () => {
        const cues = Array.from({ length: 5 }, (_, i) =>
            cue(`c${i}`, i, i + 1)
        );
        const { scheduler, send, onTranslated } = setup(cues);
        scheduler.start();

        await tick(0);
        expect(send).toHaveBeenCalledTimes(MAX_CUES_PER_PASS);
        expect(cues.slice(0, 3).map((c) => c.translated)).toEqual([
            'T:text c0',
            'T:text c1',
            'T:text c2',
        ]);
        expect(cues[3]?.translated).toBeNull();

        await tick(49);
        expect(send).toHaveBeenCalledTimes(3);
        await tick(1);
        expect(send).toHaveBeenCalledTimes(5);
        expect(onTranslated).toHaveBeenCalledTimes(5);
        expect(send.mock.calls[0]?.[0]).toEqual({
            action: 'translate',
            text: 'text c0',
            targetLang: 'zh-CN',
            cueStart: 0,
            cueVideoId: 'v1',
        });
    });

    it('follows the playhead through the clock poll', async () => {
        const far = cue('far', 100, 102);
        const { scheduler, send, clock } = setup([far]);
        scheduler.start();
        await tick(0);
        expect(send).not.toHaveBeenCalled();

        clock.time = 95;
        await tick(1001);
        expect(send).toHaveBeenCalledTimes(1);
        expect(far.translated).toBe('T:text far');
    });

    it('waits for a clock before doing anything', async () => {
        const { scheduler, send, clock } = setup([cue('a', 0, 1)], {
            time: null,
        });
        scheduler.start();
        await tick(0);
        expect(send).not.toHaveBeenCalled();
        clock.time = 0;
        await tick(1001);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('defers a retryable failure, retries after the hint, then paints the API error', async () => {
        const target = cue('a', 0, 1);
        const { scheduler, send } = setup([target], {
            respond: () => Promise.resolve(failure(true, 2000)),
        });
        scheduler.start();

        await tick(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(target.translated).toBeNull();
        await tick(1999);
        expect(send).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(target.translated).toBeNull();
        await tick(2000);
        expect(send).toHaveBeenCalledTimes(3);
        expect(target.translated).toBe('[API]');
        await tick(5000);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('never waits less than a second on a retryable failure', async () => {
        const target = cue('a', 0, 1);
        const { scheduler, send } = setup([target], {
            respond: (text, call) =>
                Promise.resolve(call === 1 ? failure(true, 0) : ok(text)),
        });
        scheduler.start();
        await tick(0);
        await tick(999);
        expect(send).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(send).toHaveBeenCalledTimes(2);
        expect(target.translated).toBe('T:text a');
    });

    it('paints the API error immediately for a final failure', async () => {
        const target = cue('a', 0, 1);
        const { scheduler, send } = setup([target], {
            respond: () => Promise.resolve(failure(false)),
        });
        scheduler.start();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(1);
        expect(target.translated).toBe('[API]');
    });

    it('paints the request error when delivery fails', async () => {
        const target = cue('a', 0, 1);
        const { scheduler, onTranslated } = setup([target], {
            respond: () =>
                Promise.reject(new Error('Receiving end does not exist')),
        });
        scheduler.start();
        await tick(0);
        expect(target.translated).toBe('[REQUEST]');
        expect(onTranslated).toHaveBeenCalledTimes(1);
    });

    it('a seek preempts a deferral wait', async () => {
        const deferred = cue('deferred', 0, 1);
        const elsewhere = cue('elsewhere', 60, 61);
        const { scheduler, send, clock } = setup([deferred, elsewhere], {
            respond: (text) =>
                Promise.resolve(
                    text === 'text deferred' ? failure(true, 5000) : ok(text)
                ),
        });
        scheduler.start();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(1);

        clock.time = 60;
        scheduler.kick();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(2);
        expect(elsewhere.translated).toBe('T:text elsewhere');
    });

    it('re-runs after the current pass when kicked mid-flight', async () => {
        const first = cue('first', 0, 1);
        const second = cue('second', 50, 51);
        const gate = Promise.withResolvers<TranslateResponse>();
        const { scheduler, send, clock } = setup([first, second], {
            respond: (text) =>
                text === 'text first'
                    ? gate.promise
                    : Promise.resolve(ok(text)),
        });
        scheduler.start();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(1);

        clock.time = 50;
        scheduler.kick();
        gate.resolve(ok('text first'));
        await tick(0);
        expect(send).toHaveBeenCalledTimes(2);
        expect(second.translated).toBe('T:text second');
    });

    it('pauses while subtitles are off and resumes when they come back', async () => {
        const cues = [cue('a', 0, 1), cue('b', 2, 3)];
        const { scheduler, send } = setup(cues);
        scheduler.start();
        scheduler.setActive(false);
        await tick(5000);
        expect(send).not.toHaveBeenCalled();

        scheduler.setActive(true);
        await tick(0);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('stops completely once its scope ends', async () => {
        const cues = Array.from({ length: 6 }, (_, i) =>
            cue(`c${i}`, i, i + 1)
        );
        const { scheduler, send, controller } = setup(cues);
        scheduler.start();
        await tick(0);
        expect(send).toHaveBeenCalledTimes(3);

        controller.abort();
        await tick(5000);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('does not apply a response that arrives after the scope ended', async () => {
        const target = cue('a', 0, 1);
        const gate = Promise.withResolvers<TranslateResponse>();
        const { scheduler, controller, onTranslated } = setup([target], {
            respond: () => gate.promise,
        });
        scheduler.start();
        await tick(0);
        controller.abort();
        gate.resolve(ok('text a'));
        await tick(0);
        expect(target.translated).toBeNull();
        expect(onTranslated).not.toHaveBeenCalled();
    });
});
