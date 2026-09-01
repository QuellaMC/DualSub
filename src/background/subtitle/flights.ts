import { createLogger } from '@/shared/logger';
import type { FetchVttResponse } from '@/messaging/contracts/fetchVtt';
import type { AuthorizedSubtitleRequest } from './policy';

const MAX_SUBTITLE_RESPONDERS_PER_FLIGHT = 8;
const MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE = 2;
const MAX_SUBTITLE_FLIGHTS_GLOBAL = 8;

export const SUBTITLE_REQUEST_REJECTED_RESPONSE: FetchVttResponse =
    Object.freeze({
        success: false,
        error: 'Subtitle request rejected.',
    });

export const SUBTITLE_READINESS_FAILURE_RESPONSE: FetchVttResponse =
    Object.freeze({
        success: false,
        error: 'Subtitle services are unavailable.',
    });

interface Flight {
    snapshot: AuthorizedSubtitleRequest;
    controller: AbortController;
    settled: boolean;
    responderCount: number;
    readonly promise: Promise<FetchVttResponse>;
    settle: (response: FetchVttResponse) => void;
}

function sameLease(
    a: AuthorizedSubtitleRequest,
    b: AuthorizedSubtitleRequest
): boolean {
    return (
        a.source === b.source && a.tabId === b.tabId && a.videoId === b.videoId
    );
}

function sameRequest(
    a: AuthorizedSubtitleRequest,
    b: AuthorizedSubtitleRequest
): boolean {
    if (
        !sameLease(a, b) ||
        a.targetLanguage !== b.targetLanguage ||
        a.originalLanguage !== b.originalLanguage
    ) {
        return false;
    }
    if (a.source === 'disneyplus' && b.source === 'disneyplus') {
        return a.url === b.url;
    }
    if (a.source === 'netflix' && b.source === 'netflix') {
        return (
            a.useOfficialTranslations === b.useOfficialTranslations &&
            a.tracks.length === b.tracks.length &&
            a.tracks.every((track, index) => {
                const other = b.tracks[index]!;
                return (
                    track.language === other.language &&
                    track.displayName === other.displayName &&
                    track.trackType === other.trackType &&
                    track.downloadUrl === other.downloadUrl
                );
            })
        );
    }
    return false;
}

/**
 * Admission control for subtitle processing:
 * - identical concurrent requests coalesce into one flight (≤8 awaiters)
 * - a new request for the same [source, tab, video] lease supersedes and
 *   aborts the old flight (its awaiters get the rejected response)
 * - at most 2 flights per tab+source and 8 globally.
 */
export class SubtitleFlightTable {
    private readonly flights = new Set<Flight>();
    private readonly logger = createLogger('SubtitleFlights');

    admit(
        snapshot: AuthorizedSubtitleRequest,
        run: (signal: AbortSignal) => Promise<FetchVttResponse>
    ): Promise<FetchVttResponse> {
        for (const flight of this.flights) {
            if (!flight.settled && sameRequest(flight.snapshot, snapshot)) {
                if (
                    flight.responderCount >= MAX_SUBTITLE_RESPONDERS_PER_FLIGHT
                ) {
                    this.logger.warn('Subtitle request capacity reached', {
                        scope: 'responders',
                    });
                    return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
                }
                flight.responderCount += 1;
                return flight.promise;
            }
        }

        for (const flight of [...this.flights]) {
            if (!flight.settled && sameLease(flight.snapshot, snapshot)) {
                this.supersede(flight);
            }
        }

        let partitionCount = 0;
        for (const flight of this.flights) {
            if (
                !flight.settled &&
                flight.snapshot.tabId === snapshot.tabId &&
                flight.snapshot.source === snapshot.source
            ) {
                partitionCount += 1;
            }
        }
        if (partitionCount >= MAX_SUBTITLE_FLIGHTS_PER_TAB_SOURCE) {
            this.logger.warn('Subtitle request capacity reached', {
                scope: 'tab-source',
                count: partitionCount,
            });
            return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        }
        if (this.flights.size >= MAX_SUBTITLE_FLIGHTS_GLOBAL) {
            this.logger.warn('Subtitle request capacity reached', {
                scope: 'global',
                count: this.flights.size,
            });
            return Promise.resolve(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        }

        const { promise, resolve } = Promise.withResolvers<FetchVttResponse>();
        const flight: Flight = {
            snapshot,
            controller: new AbortController(),
            settled: false,
            responderCount: 1,
            promise,
            settle: (response) => {
                if (!flight.settled) {
                    flight.settled = true;
                    this.flights.delete(flight);
                    resolve(response);
                }
            },
        };
        this.flights.add(flight);

        run(flight.controller.signal).then(
            (response) => flight.settle(response),
            () => flight.settle(SUBTITLE_REQUEST_REJECTED_RESPONSE)
        );
        return promise;
    }

    private supersede(flight: Flight): void {
        flight.settle(SUBTITLE_REQUEST_REJECTED_RESPONSE);
        flight.controller.abort();
    }

    /** Settle everything (worker teardown). */
    destroy(): void {
        for (const flight of [...this.flights]) {
            flight.settle(SUBTITLE_READINESS_FAILURE_RESPONSE);
            flight.controller.abort();
        }
    }
}
