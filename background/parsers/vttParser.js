/**
 * VTT Parser with M3U8 Support
 *
 * Parses M3U8 playlists and combines segmented subtitle files.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';
import { fetchAuthorizedSubtitleText } from '../utils/subtitleFetch.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';
import {
    getUtf8ByteLength,
    isResponseBodyLimitError,
} from '../../utils/fetchWithTimeout.js';

export const MAX_VTT_SEGMENT_CONCURRENCY = 6;
// Disney classifies the first fetched body only after reading it, so this cap
// intentionally applies to both M3U8 playlists and direct VTT resources.
export const MAX_M3U8_PLAYLIST_BYTES = 2 * 1024 * 1024;
export const MAX_M3U8_LINE_BYTES = 8 * 1024;
export const MAX_M3U8_SEGMENT_COUNT = 5000;
export const MAX_VTT_SEGMENT_BYTES = 512 * 1024;
export const MAX_VTT_AGGREGATE_BYTES = 16 * 1024 * 1024;
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const INTERNAL_VTT_TERMINAL_ERRORS = new WeakSet();

function markInternalVttTerminalError(error) {
    INTERNAL_VTT_TERMINAL_ERRORS.add(error);
    return error;
}

export class VTTResourceLimitError extends Error {
    constructor(limitKind, limit, observed) {
        super(`${limitKind} exceeds the configured resource limit.`);
        this.name = 'VTTResourceLimitError';
        this.code = 'ERR_VTT_RESOURCE_LIMIT';
        this.limitKind = limitKind;
        this.limit = limit;
        this.observed = observed;
    }
}

function createVttResourceLimitError(limitKind, limit, observed) {
    return markInternalVttTerminalError(
        new VTTResourceLimitError(limitKind, limit, observed)
    );
}

function createParserAuthorizationError() {
    const error = new Error('VTT playlist request is unauthorized.');
    error.name = 'VTTParserAuthorizationError';
    error.code = 'ERR_VTT_REQUEST_UNAUTHORIZED';
    return error;
}

class VTTParserInputError extends TypeError {
    constructor() {
        super('VTT playlist processing input is invalid.');
        this.name = 'VTTParserInputError';
        this.code = 'ERR_VTT_INPUT_INVALID';
    }
}

function createVttParserInputError() {
    return markInternalVttTerminalError(new VTTParserInputError());
}

function createAbortError() {
    const error = new Error('VTT playlist processing was aborted.');
    error.name = 'AbortError';
    error.code = 'ERR_VTT_PROCESSING_ABORTED';
    return error;
}

function createEmptyPlaylistError() {
    const error = new Error('No VTT segments found in M3U8 playlist.');
    error.code = 'ERR_VTT_SEGMENTS_EMPTY';
    return error;
}

function createUnavailableSegmentsError() {
    const error = new Error('No VTT segments could be fetched.');
    error.code = 'ERR_VTT_SEGMENTS_UNAVAILABLE';
    return error;
}

function assertAuthorizedDisneySnapshot(snapshot) {
    if (
        !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
        snapshot.source !== SubtitleRequestSources.DISNEY_PLUS
    ) {
        throw createParserAuthorizationError();
    }
}

function isTerminalWorkerError(error) {
    return (
        INTERNAL_VTT_TERMINAL_ERRORS.has(error) ||
        isResponseBodyLimitError(error)
    );
}

function assertM3u8SegmentCount(segmentCount) {
    if (segmentCount > MAX_M3U8_SEGMENT_COUNT) {
        throw createVttResourceLimitError(
            'segmentCount',
            MAX_M3U8_SEGMENT_COUNT,
            segmentCount
        );
    }
}

function readCallerSignal(options) {
    let callerSignal;
    try {
        if (
            options === null ||
            (typeof options !== 'object' && typeof options !== 'function')
        ) {
            throw new TypeError();
        }
        callerSignal = options.signal;
    } catch {
        throw createVttParserInputError();
    }

    if (callerSignal === null || callerSignal === undefined) return null;
    try {
        if (typeof ABORT_SIGNAL_ABORTED_GETTER !== 'function') {
            throw new TypeError();
        }
        ABORT_SIGNAL_ABORTED_GETTER.call(callerSignal);
        return callerSignal;
    } catch {
        throw createVttParserInputError();
    }
}

function isCallerSignalAborted(callerSignal) {
    if (callerSignal === null) return false;
    try {
        return ABORT_SIGNAL_ABORTED_GETTER.call(callerSignal);
    } catch {
        throw createVttParserInputError();
    }
}

function linkCallerAbort(callerSignal, onAbort) {
    if (callerSignal === null) return () => {};
    if (isCallerSignalAborted(callerSignal)) {
        onAbort();
        return () => {};
    }
    try {
        ADD_EVENT_LISTENER.call(callerSignal, 'abort', onAbort, { once: true });
    } catch {
        throw createVttParserInputError();
    }
    return () => {
        try {
            REMOVE_EVENT_LISTENER.call(callerSignal, 'abort', onAbort);
        } catch (_) {}
    };
}

function validateSegmentInputs(segmentReferences, playlistCanonicalUrl) {
    try {
        if (
            !Array.isArray(segmentReferences) ||
            typeof playlistCanonicalUrl !== 'string' ||
            playlistCanonicalUrl.trim().length === 0
        ) {
            throw createVttParserInputError();
        }

        const segmentCount = segmentReferences.length;
        if (!Number.isSafeInteger(segmentCount) || segmentCount <= 0) {
            throw createVttParserInputError();
        }
        assertM3u8SegmentCount(segmentCount);

        const references = new Array(segmentCount);
        for (let index = 0; index < segmentCount; index++) {
            const reference = segmentReferences[index];
            if (typeof reference !== 'string' || reference.length === 0) {
                throw createVttParserInputError();
            }
            references[index] = reference;
        }
        return references;
    } catch (error) {
        if (INTERNAL_VTT_TERMINAL_ERRORS.has(error)) {
            throw error;
        }
        throw createVttParserInputError();
    }
}

class VTTParser {
    constructor() {
        this.logger = loggingManager.createLogger('VTTParser');
    }

    /**
     * Parse M3U8 playlist text into unresolved VTT segment references.
     * @param {string} playlistText - M3U8 playlist content
     * @returns {string[]} Ordered raw segment references
     */
    parsePlaylistForVttSegmentReferences(playlistText) {
        if (typeof playlistText !== 'string') {
            throw createVttParserInputError();
        }
        const playlistBytes = getUtf8ByteLength(playlistText);
        if (playlistBytes > MAX_M3U8_PLAYLIST_BYTES) {
            throw createVttResourceLimitError(
                'playlistBytes',
                MAX_M3U8_PLAYLIST_BYTES,
                playlistBytes
            );
        }

        this.logger.debug('Parsing M3U8 playlist for VTT segments', {
            contentLength: playlistText.length,
        });

        const lines = playlistText.split('\n');
        const segmentReferences = [];

        this.logger.debug('M3U8 playlist structure inspected', {
            totalLines: lines.length,
        });

        for (const rawLine of lines) {
            const line = rawLine.endsWith('\r')
                ? rawLine.slice(0, -1)
                : rawLine;
            const lineBytes = getUtf8ByteLength(line);
            if (lineBytes > MAX_M3U8_LINE_BYTES) {
                throw createVttResourceLimitError(
                    'lineBytes',
                    MAX_M3U8_LINE_BYTES,
                    lineBytes
                );
            }

            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                // In a media playlist, every non-comment line is a segment URI.
                // Resolution and authorization belong exclusively to the
                // shared subtitle transport at fetch time.
                segmentReferences.push(trimmedLine);
                assertM3u8SegmentCount(segmentReferences.length);
            }
        }

        this.logger.info('M3U8 playlist parsing completed', {
            segmentCount: segmentReferences.length,
        });

        return segmentReferences;
    }

    /**
     * Fetch and combine raw VTT segment references through authorized transport.
     * @param {object} snapshot - Authorized Disney subtitle request snapshot
     * @param {string[]} segmentReferences - Ordered raw segment references
     * @param {string} playlistCanonicalUrl - Canonical media-playlist URL
     * @param {Object} options - Processing options
     * @param {AbortSignal} [options.signal] - Optional caller abort signal
     * @returns {Promise<string>} Combined VTT content
     */
    async fetchAndCombineVttSegments(
        snapshot,
        segmentReferences,
        playlistCanonicalUrl,
        options = {}
    ) {
        assertAuthorizedDisneySnapshot(snapshot);
        const references = validateSegmentInputs(
            segmentReferences,
            playlistCanonicalUrl
        );
        const callerSignal = readCallerSignal(options);

        this.logger.info('Fetching VTT segments from playlist', {
            segmentCount: references.length,
        });

        const controller = new AbortController();
        const segmentTexts = new Array(references.length).fill('');
        const segmentSucceeded = new Array(references.length).fill(false);
        let nextSegmentIndex = 0;
        let aggregateBytes = 0;
        let terminalError = null;
        const settleTerminal = (error) => {
            if (terminalError) return terminalError;
            terminalError = error;
            try {
                controller.abort();
            } catch (_) {}
            return terminalError;
        };
        const forwardCallerAbort = () => {
            settleTerminal(createAbortError());
        };
        const unlinkCallerAbort = linkCallerAbort(
            callerSignal,
            forwardCallerAbort
        );
        const fetchNextSegment = async () => {
            while (
                !terminalError &&
                !controller.signal.aborted &&
                nextSegmentIndex < references.length
            ) {
                const segmentIndex = nextSegmentIndex++;
                const reference = references[segmentIndex];
                try {
                    const { text: segmentText } =
                        await fetchAuthorizedSubtitleText(snapshot, reference, {
                            baseUrl: playlistCanonicalUrl,
                            stage: 'vtt-segment',
                            signal: controller.signal,
                            maxBytes: MAX_VTT_SEGMENT_BYTES,
                        });
                    if (terminalError) return;
                    if (typeof segmentText !== 'string') {
                        throw createVttParserInputError();
                    }
                    if (segmentText.length === 0) continue;
                    const nextAggregateBytes =
                        aggregateBytes + getUtf8ByteLength(segmentText);
                    if (nextAggregateBytes > MAX_VTT_AGGREGATE_BYTES) {
                        throw createVttResourceLimitError(
                            'aggregateBytes',
                            MAX_VTT_AGGREGATE_BYTES,
                            nextAggregateBytes
                        );
                    }
                    aggregateBytes = nextAggregateBytes;
                    segmentTexts[segmentIndex] = segmentText;
                    segmentSucceeded[segmentIndex] = true;
                } catch (error) {
                    if (isTerminalWorkerError(error)) {
                        settleTerminal(error);
                        return;
                    }
                    if (terminalError || controller.signal.aborted) return;
                    this.logger.warn('VTT segment was unavailable');
                }
            }
        };

        const workerCount = Math.min(
            MAX_VTT_SEGMENT_CONCURRENCY,
            references.length
        );
        try {
            if (terminalError) throw terminalError;
            await Promise.all(
                Array.from({ length: workerCount }, () => fetchNextSegment())
            );
        } finally {
            unlinkCallerAbort();
        }

        if (terminalError) {
            throw terminalError;
        }
        let combinedVttText = 'WEBVTT\n\n';
        let segmentsFetchedCount = 0;

        for (let index = 0; index < segmentTexts.length; index++) {
            if (!segmentSucceeded[index]) continue;
            segmentsFetchedCount++;
            // Remove WEBVTT header from individual segments
            const cleanedSegment = segmentTexts[index]
                .replace(/^WEBVTT\s*/i, '')
                .trim();
            if (cleanedSegment) {
                combinedVttText += cleanedSegment + '\n\n';
            }
        }

        if (segmentsFetchedCount === 0) {
            const error = createUnavailableSegmentsError();
            this.logger.error('No VTT segments could be fetched', {
                segmentCount: references.length,
                stage: 'segment-fetch',
            });
            throw error;
        }

        this.logger.info('VTT segments combined successfully', {
            segmentsFetched: segmentsFetchedCount,
            totalSegments: references.length,
            combinedLength: combinedVttText.length,
        });

        return combinedVttText;
    }

    /**
     * Process already-fetched M3U8 text and return combined VTT content
     * @param {object} snapshot - Authorized Disney subtitle request snapshot
     * @param {string} playlistText - M3U8 playlist content
     * @param {string} playlistCanonicalUrl - Canonical playlist URL
     * @param {Object} options - Processing options
     * @param {AbortSignal} [options.signal] - Optional caller abort signal
     * @returns {Promise<string>} Combined VTT content
     */
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
            this.logger.warn('No VTT segments found in M3U8 playlist', {
                playlistLength: playlistText.length,
                linesCount: playlistText.split('\n').length,
            });

            throw createEmptyPlaylistError();
        }

        const combinedVtt = await this.fetchAndCombineVttSegments(
            snapshot,
            segmentReferences,
            playlistCanonicalUrl,
            options
        );

        this.logger.info('M3U8 playlist processing completed', {
            segmentCount: segmentReferences.length,
            finalVttLength: combinedVtt.length,
        });

        return combinedVtt;
    }
}

// Export singleton instance
export const vttParser = new VTTParser();
