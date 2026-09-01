import { describe, expect, it, vi } from 'vitest';
import type { FetchVttResponse } from '@/messaging/contracts/fetchVtt';
import type { AuthorizedSubtitleRequest } from './policy';
import {
    SUBTITLE_READINESS_FAILURE_RESPONSE,
    SUBTITLE_REQUEST_REJECTED_RESPONSE,
    SubtitleFlightTable,
} from './flights';

function disneyRequest(
    overrides: Partial<
        Extract<AuthorizedSubtitleRequest, { source: 'disneyplus' }>
    > = {}
): AuthorizedSubtitleRequest {
    return {
        source: 'disneyplus',
        tabId: 1,
        videoId: 'v1',
        url: 'https://cdn.media.dssott.com/master.m3u8',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        ...overrides,
    };
}

const OK: FetchVttResponse = {
    success: true,
    vttText: 'WEBVTT',
    targetVttText: null,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    useNativeTarget: false,
    selectedLanguage: { normalizedCode: 'en', displayName: 'English' },
};

function deferredRun() {
    const { promise, resolve } = Promise.withResolvers<FetchVttResponse>();
    const run = vi.fn(() => promise);
    return { run, resolve };
}

describe('SubtitleFlightTable', () => {
    it('coalesces identical concurrent requests into one run', async () => {
        const table = new SubtitleFlightTable();
        const { run, resolve } = deferredRun();

        const first = table.admit(disneyRequest(), run);
        const second = table.admit(disneyRequest(), run);
        expect(run).toHaveBeenCalledTimes(1);

        resolve(OK);
        await expect(first).resolves.toEqual(OK);
        await expect(second).resolves.toEqual(OK);
    });

    it('caps coalesced responders at 8', async () => {
        const table = new SubtitleFlightTable();
        const { run, resolve } = deferredRun();
        const admitted = Array.from({ length: 8 }, () =>
            table.admit(disneyRequest(), run)
        );
        await expect(table.admit(disneyRequest(), run)).resolves.toEqual(
            SUBTITLE_REQUEST_REJECTED_RESPONSE
        );
        resolve(OK);
        await Promise.all(admitted);
    });

    it('supersedes and aborts an older flight for the same lease', async () => {
        const table = new SubtitleFlightTable();
        let observedSignal: AbortSignal | undefined;
        const stale = table.admit(disneyRequest(), (signal) => {
            observedSignal = signal;
            return new Promise<FetchVttResponse>(() => undefined);
        });

        const fresh = table.admit(
            disneyRequest({
                url: 'https://cdn.media.dssott.com/other-master.m3u8',
            }),
            () => Promise.resolve(OK)
        );

        await expect(stale).resolves.toEqual(
            SUBTITLE_REQUEST_REJECTED_RESPONSE
        );
        expect(observedSignal?.aborted).toBe(true);
        await expect(fresh).resolves.toEqual(OK);
    });

    it('enforces per-tab-source and global caps', async () => {
        const table = new SubtitleFlightTable();
        const never = () => new Promise<FetchVttResponse>(() => undefined);

        void table.admit(disneyRequest({ videoId: 'a' }), never);
        void table.admit(disneyRequest({ videoId: 'b' }), never);
        await expect(
            table.admit(disneyRequest({ videoId: 'c' }), never)
        ).resolves.toEqual(SUBTITLE_REQUEST_REJECTED_RESPONSE);

        // Different tabs are separate partitions, but at most 8 total.
        for (let tab = 2; tab <= 4; tab += 1) {
            void table.admit(
                disneyRequest({ tabId: tab, videoId: 'a' }),
                never
            );
            void table.admit(
                disneyRequest({ tabId: tab, videoId: 'b' }),
                never
            );
        }
        await expect(
            table.admit(disneyRequest({ tabId: 9, videoId: 'x' }), never)
        ).resolves.toEqual(SUBTITLE_REQUEST_REJECTED_RESPONSE);
    });

    it('a failing run settles as a rejected response, not an unhandled rejection', async () => {
        const table = new SubtitleFlightTable();
        await expect(
            table.admit(disneyRequest(), () =>
                Promise.reject(new Error('pipeline exploded'))
            )
        ).resolves.toEqual(SUBTITLE_REQUEST_REJECTED_RESPONSE);
    });

    it('destroy settles every open flight with the readiness failure', async () => {
        const table = new SubtitleFlightTable();
        const open = table.admit(
            disneyRequest(),
            () => new Promise<FetchVttResponse>(() => undefined)
        );
        table.destroy();
        await expect(open).resolves.toEqual(
            SUBTITLE_READINESS_FAILURE_RESPONSE
        );
    });
});
