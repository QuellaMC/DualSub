import { createLogger } from '@/shared/logger';
import { isResponseBodyLimitError } from '@/shared/fetchWithTimeout';
import { utf8ByteLength } from '@/messaging/snapshot';
import { fetchAuthorizedSubtitleText } from '../fetch';
import type { DisneyAuthorizedRequest } from '../policy';

export const MAX_VTT_SEGMENT_CONCURRENCY = 6;
// Disney classifies the first fetched body only after reading it, so this cap
// intentionally applies to both M3U8 playlists and direct VTT resources.
export const MAX_M3U8_PLAYLIST_BYTES = 2 * 1024 * 1024;
export const MAX_M3U8_LINE_BYTES = 8 * 1024;
export const MAX_M3U8_SEGMENT_COUNT = 5000;
export const MAX_VTT_SEGMENT_BYTES = 512 * 1024;
export const MAX_VTT_AGGREGATE_BYTES = 16 * 1024 * 1024;

const logger = createLogger('M3U8Parser');

export class VTTResourceLimitError extends Error {
    override readonly name = 'VTTResourceLimitError';
    readonly code = 'ERR_VTT_RESOURCE_LIMIT';
    readonly limitKind: string;
    readonly limit: number;
    readonly observed: number;

    constructor(limitKind: string, limit: number, observed: number) {
        super(`${limitKind} exceeds the configured resource limit.`);
        this.limitKind = limitKind;
        this.limit = limit;
        this.observed = observed;
    }
}

export class VttSegmentsUnavailableError extends Error {
    readonly code = 'ERR_VTT_SEGMENTS_UNAVAILABLE';

    constructor() {
        super('No VTT segments could be fetched.');
    }
}

export class EmptyPlaylistError extends Error {
    readonly code = 'ERR_VTT_SEGMENTS_EMPTY';

    constructor() {
        super('No VTT segments found in M3U8 playlist.');
    }
}

function assertSegmentCount(segmentCount: number): void {
    if (segmentCount > MAX_M3U8_SEGMENT_COUNT) {
        throw new VTTResourceLimitError(
            'segmentCount',
            MAX_M3U8_SEGMENT_COUNT,
            segmentCount
        );
    }
}

/** Parse a media playlist into ordered raw segment references. Resolution and
 *  authorization belong exclusively to the subtitle transport at fetch time. */
export function parsePlaylistForVttSegmentReferences(
    playlistText: string
): string[] {
    const playlistBytes = utf8ByteLength(playlistText);
    if (playlistBytes > MAX_M3U8_PLAYLIST_BYTES) {
        throw new VTTResourceLimitError(
            'playlistBytes',
            MAX_M3U8_PLAYLIST_BYTES,
            playlistBytes
        );
    }

    const segmentReferences: string[] = [];
    for (const rawLine of playlistText.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const lineBytes = utf8ByteLength(line);
        if (lineBytes > MAX_M3U8_LINE_BYTES) {
            throw new VTTResourceLimitError(
                'lineBytes',
                MAX_M3U8_LINE_BYTES,
                lineBytes
            );
        }
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            segmentReferences.push(trimmedLine);
            assertSegmentCount(segmentReferences.length);
        }
    }
    return segmentReferences;
}

function isTerminalSegmentError(error: unknown): error is Error {
    return (
        error instanceof VTTResourceLimitError ||
        isResponseBodyLimitError(error) ||
        (error instanceof Error && error.name === 'AbortError')
    );
}

/**
 * Fetch and combine VTT segments with bounded concurrency. Individual segment
 * failures are tolerated (a gap beats losing the whole track); resource-limit
 * violations and aborts are terminal and cancel the remaining workers.
 */
export async function fetchAndCombineVttSegments(
    snapshot: DisneyAuthorizedRequest,
    segmentReferences: readonly string[],
    playlistCanonicalUrl: string,
    options: { signal?: AbortSignal } = {}
): Promise<string> {
    assertSegmentCount(segmentReferences.length);

    const controller = new AbortController();
    const signals = [controller.signal];
    if (options.signal) {
        signals.push(options.signal);
    }
    const signal = AbortSignal.any(signals);

    const segmentTexts = new Array<string>(segmentReferences.length).fill('');
    const segmentSucceeded = new Array<boolean>(segmentReferences.length).fill(
        false
    );
    let nextSegmentIndex = 0;
    let aggregateBytes = 0;
    const terminal: { error: Error | null } = { error: null };

    const settleTerminal = (error: Error): void => {
        if (terminal.error === null) {
            terminal.error = error;
            controller.abort(error);
        }
    };

    const fetchNextSegment = async (): Promise<void> => {
        while (
            terminal.error === null &&
            !signal.aborted &&
            nextSegmentIndex < segmentReferences.length
        ) {
            const segmentIndex = nextSegmentIndex++;
            const reference = segmentReferences[segmentIndex]!;
            try {
                const { text: segmentText } = await fetchAuthorizedSubtitleText(
                    snapshot,
                    reference,
                    {
                        baseUrl: playlistCanonicalUrl,
                        stage: 'vtt-segment',
                        signal,
                        maxBytes: MAX_VTT_SEGMENT_BYTES,
                    }
                );
                if (terminal.error !== null) {
                    return;
                }
                if (segmentText.length === 0) {
                    continue;
                }
                const nextAggregateBytes =
                    aggregateBytes + utf8ByteLength(segmentText);
                if (nextAggregateBytes > MAX_VTT_AGGREGATE_BYTES) {
                    throw new VTTResourceLimitError(
                        'aggregateBytes',
                        MAX_VTT_AGGREGATE_BYTES,
                        nextAggregateBytes
                    );
                }
                aggregateBytes = nextAggregateBytes;
                segmentTexts[segmentIndex] = segmentText;
                segmentSucceeded[segmentIndex] = true;
            } catch (error) {
                if (isTerminalSegmentError(error)) {
                    settleTerminal(error);
                    return;
                }
                if (terminal.error !== null || signal.aborted) {
                    return;
                }
                logger.warn('VTT segment was unavailable');
            }
        }
    };

    const workerCount = Math.min(
        MAX_VTT_SEGMENT_CONCURRENCY,
        segmentReferences.length
    );
    await Promise.all(
        Array.from({ length: workerCount }, () => fetchNextSegment())
    );

    if (terminal.error !== null) {
        throw terminal.error;
    }
    if (options.signal?.aborted) {
        const reason: unknown = options.signal.reason;
        throw reason instanceof Error
            ? reason
            : new DOMException('Aborted', 'AbortError');
    }

    let combinedVttText = 'WEBVTT\n\n';
    let segmentsFetchedCount = 0;
    for (let index = 0; index < segmentTexts.length; index += 1) {
        if (!segmentSucceeded[index]) {
            continue;
        }
        segmentsFetchedCount += 1;
        const cleanedSegment = segmentTexts[index]!.replace(
            /^WEBVTT\s*/i,
            ''
        ).trim();
        if (cleanedSegment) {
            combinedVttText += cleanedSegment + '\n\n';
        }
    }

    if (segmentsFetchedCount === 0) {
        throw new VttSegmentsUnavailableError();
    }
    logger.info('VTT segments combined', {
        segmentsFetched: segmentsFetchedCount,
        totalSegments: segmentReferences.length,
    });
    return combinedVttText;
}

/** Full pipeline: media playlist text → combined VTT. */
export async function processM3U8PlaylistText(
    snapshot: DisneyAuthorizedRequest,
    playlistText: string,
    playlistCanonicalUrl: string,
    options: { signal?: AbortSignal } = {}
): Promise<string> {
    const segmentReferences =
        parsePlaylistForVttSegmentReferences(playlistText);
    if (segmentReferences.length === 0) {
        throw new EmptyPlaylistError();
    }
    return fetchAndCombineVttSegments(
        snapshot,
        segmentReferences,
        playlistCanonicalUrl,
        options
    );
}
