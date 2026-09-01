import { loggingManager } from '../utils/loggingManager.js';
import { fetchAuthorizedSubtitleText } from '../utils/subtitleFetch.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';
import {
    getUtf8ByteLength,
    isResponseBodyLimitError,
} from '../../utils/fetchWithTimeout.js';

const MAX_VTT_SEGMENT_CONCURRENCY = 6;
export const MAX_M3U8_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_M3U8_LINE_BYTES = 8 * 1024;
const MAX_M3U8_SEGMENT_COUNT = 5000;
const MAX_VTT_SEGMENT_BYTES = 512 * 1024;
const MAX_VTT_AGGREGATE_BYTES = 16 * 1024 * 1024;

class VTTResourceLimitError extends Error {
    constructor(limitKind, limit, observed) {
        super(`${limitKind} exceeds the configured resource limit.`);
        this.name = 'VTTResourceLimitError';
        this.code = 'ERR_VTT_RESOURCE_LIMIT';
        this.limitKind = limitKind;
        this.limit = limit;
        this.observed = observed;
    }
}

function resourceLimitError(limitKind, limit, observed) {
    return new VTTResourceLimitError(limitKind, limit, observed);
}

function parserError(message, code, name = 'Error') {
    const error = new Error(message);
    error.name = name;
    error.code = code;
    return error;
}

function assertAuthorizedDisneySnapshot(snapshot) {
    if (
        !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
        snapshot.source !== SubtitleRequestSources.DISNEY_PLUS
    ) {
        throw parserError(
            'VTT playlist request is unauthorized.',
            'ERR_VTT_REQUEST_UNAUTHORIZED',
            'VTTParserAuthorizationError'
        );
    }
}

function assertSegmentCount(segmentCount) {
    if (segmentCount > MAX_M3U8_SEGMENT_COUNT) {
        throw resourceLimitError(
            'segmentCount',
            MAX_M3U8_SEGMENT_COUNT,
            segmentCount
        );
    }
}

function validateSegmentInputs(segmentReferences, playlistCanonicalUrl) {
    if (
        !Array.isArray(segmentReferences) ||
        segmentReferences.length === 0 ||
        typeof playlistCanonicalUrl !== 'string' ||
        playlistCanonicalUrl.trim() === '' ||
        !segmentReferences.every(
            (reference) => typeof reference === 'string' && reference.length > 0
        )
    ) {
        throw parserError(
            'VTT playlist processing input is invalid.',
            'ERR_VTT_INPUT_INVALID',
            'VTTParserInputError'
        );
    }
    assertSegmentCount(segmentReferences.length);
    return [...segmentReferences];
}

function createAbortError() {
    return parserError(
        'VTT playlist processing was aborted.',
        'ERR_VTT_PROCESSING_ABORTED',
        'AbortError'
    );
}

function isTerminalSegmentError(error) {
    return (
        error instanceof VTTResourceLimitError ||
        isResponseBodyLimitError(error)
    );
}

class VTTParser {
    constructor() {
        this.logger = loggingManager.createLogger('VTTParser');
    }

    parsePlaylistForVttSegmentReferences(playlistText) {
        if (typeof playlistText !== 'string') {
            throw parserError(
                'VTT playlist processing input is invalid.',
                'ERR_VTT_INPUT_INVALID',
                'VTTParserInputError'
            );
        }

        const playlistBytes = getUtf8ByteLength(playlistText);
        if (playlistBytes > MAX_M3U8_PLAYLIST_BYTES) {
            throw resourceLimitError(
                'playlistBytes',
                MAX_M3U8_PLAYLIST_BYTES,
                playlistBytes
            );
        }

        const segmentReferences = [];
        for (const rawLine of playlistText.split('\n')) {
            const line = rawLine.endsWith('\r')
                ? rawLine.slice(0, -1)
                : rawLine;
            const lineBytes = getUtf8ByteLength(line);
            if (lineBytes > MAX_M3U8_LINE_BYTES) {
                throw resourceLimitError(
                    'lineBytes',
                    MAX_M3U8_LINE_BYTES,
                    lineBytes
                );
            }

            const reference = line.trim();
            if (!reference || reference.startsWith('#')) continue;
            segmentReferences.push(reference);
            assertSegmentCount(segmentReferences.length);
        }

        return segmentReferences;
    }

    async fetchAndCombineVttSegments(
        snapshot,
        segmentReferences,
        playlistCanonicalUrl,
        { signal: callerSignal } = {}
    ) {
        assertAuthorizedDisneySnapshot(snapshot);
        const references = validateSegmentInputs(
            segmentReferences,
            playlistCanonicalUrl
        );
        if (callerSignal?.aborted) throw createAbortError();

        const controller = new AbortController();
        const segmentTexts = new Array(references.length);
        let nextIndex = 0;
        let aggregateBytes = 0;
        let terminalError = null;

        const stop = (error) => {
            if (terminalError) return;
            terminalError = error;
            controller.abort();
        };
        const forwardCallerAbort = () => stop(createAbortError());
        callerSignal?.addEventListener('abort', forwardCallerAbort, {
            once: true,
        });
        if (callerSignal?.aborted) forwardCallerAbort();

        const worker = async () => {
            while (!terminalError && nextIndex < references.length) {
                const index = nextIndex++;
                try {
                    const { text } = await fetchAuthorizedSubtitleText(
                        snapshot,
                        references[index],
                        {
                            baseUrl: playlistCanonicalUrl,
                            stage: 'vtt-segment',
                            signal: controller.signal,
                            maxBytes: MAX_VTT_SEGMENT_BYTES,
                        }
                    );
                    if (terminalError || text.length === 0) continue;

                    const nextAggregateBytes =
                        aggregateBytes + getUtf8ByteLength(text);
                    if (nextAggregateBytes > MAX_VTT_AGGREGATE_BYTES) {
                        throw resourceLimitError(
                            'aggregateBytes',
                            MAX_VTT_AGGREGATE_BYTES,
                            nextAggregateBytes
                        );
                    }
                    aggregateBytes = nextAggregateBytes;
                    segmentTexts[index] = text;
                } catch (error) {
                    if (isTerminalSegmentError(error)) {
                        stop(error);
                    } else if (!terminalError) {
                        this.logger.warn('VTT segment was unavailable');
                    }
                }
            }
        };

        try {
            await Promise.all(
                Array.from(
                    {
                        length: Math.min(
                            MAX_VTT_SEGMENT_CONCURRENCY,
                            references.length
                        ),
                    },
                    worker
                )
            );
        } finally {
            callerSignal?.removeEventListener('abort', forwardCallerAbort);
        }

        if (terminalError) throw terminalError;

        const successfulSegments = segmentTexts.filter(
            (text) => typeof text === 'string'
        );
        if (successfulSegments.length === 0) {
            this.logger.error('No VTT segments could be fetched', {
                segmentCount: references.length,
                stage: 'segment-fetch',
            });
            throw parserError(
                'No VTT segments could be fetched.',
                'ERR_VTT_SEGMENTS_UNAVAILABLE'
            );
        }

        let combinedVtt = 'WEBVTT\n\n';
        for (const segmentText of successfulSegments) {
            const content = segmentText.replace(/^WEBVTT\s*/i, '').trim();
            if (content) combinedVtt += `${content}\n\n`;
        }
        return combinedVtt;
    }

    async processM3U8PlaylistText(
        snapshot,
        playlistText,
        playlistCanonicalUrl,
        options = {}
    ) {
        assertAuthorizedDisneySnapshot(snapshot);
        const segmentReferences =
            this.parsePlaylistForVttSegmentReferences(playlistText);
        if (segmentReferences.length === 0) {
            throw parserError(
                'No VTT segments found in M3U8 playlist.',
                'ERR_VTT_SEGMENTS_EMPTY'
            );
        }
        return this.fetchAndCombineVttSegments(
            snapshot,
            segmentReferences,
            playlistCanonicalUrl,
            options
        );
    }
}

export const vttParser = new VTTParser();
