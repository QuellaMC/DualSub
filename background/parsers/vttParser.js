/**
 * VTT Parser with M3U8 Support
 *
 * Parses M3U8 playlists and combines segmented subtitle files.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout.js';

class VTTParser {
    constructor() {
        this.logger = loggingManager.createLogger('VTTParser');
    }

    /**
     * Parse M3U8 playlist to extract VTT segment URLs
     * @param {string} playlistText - M3U8 playlist content
     * @param {string} playlistUrl - Base URL for resolving relative URLs
     * @returns {Array} Array of segment URLs
     */
    parsePlaylistForVttSegments(playlistText, playlistUrl) {
        this.logger.debug('Parsing M3U8 playlist for VTT segments', {
            contentLength: playlistText.length,
        });

        const lines = playlistText.split('\n');
        const segmentUrls = [];
        const baseUrl = new URL(playlistUrl);

        this.logger.debug('M3U8 playlist structure inspected', {
            totalLines: lines.length,
        });

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                this.logger.debug('Processing M3U8 line', {
                    length: trimmedLine.length,
                });

                // In a media playlist, every non-comment line is a segment URI.
                // Do not require a file extension: signed CDN URLs are commonly
                // extensionless and may contain query parameters.
                try {
                    const segmentUrl = new URL(trimmedLine, baseUrl).href;
                    segmentUrls.push(segmentUrl);
                    this.logger.debug('Found VTT segment', {
                        segmentCount: segmentUrls.length,
                    });
                } catch (error) {
                    this.logger.warn(
                        'Could not form valid URL from M3U8 line',
                        error,
                        {
                            lineLength: trimmedLine.length,
                        }
                    );
                }
            }
        }

        this.logger.info('M3U8 playlist parsing completed', {
            segmentCount: segmentUrls.length,
        });

        return segmentUrls;
    }

    /**
     * Fetch and combine VTT segments from URLs
     * @param {Array} segmentUrls - Array of segment URLs
     * @param {string} playlistUrlForLogging - Original playlist URL for logging
     * @returns {Promise<string>} Combined VTT content
     */
    async fetchAndCombineVttSegments(
        segmentUrls,
        _playlistUrlForLogging = 'N/A'
    ) {
        if (!Array.isArray(segmentUrls) || segmentUrls.length === 0) {
            throw new Error('At least one VTT segment URL is required.');
        }

        this.logger.info('Fetching VTT segments from playlist', {
            segmentCount: segmentUrls.length,
        });

        const fetchPromises = segmentUrls.map(async (url) => {
            try {
                const response = await fetchWithTimeout(url);
                if (!response.ok) {
                    throw new Error(
                        `VTT segment fetch failed: ${response.status}`
                    );
                }
                return await response.text();
            } catch (error) {
                this.logger.warn('Error fetching VTT segment', error);
                return null;
            }
        });

        const segmentTexts = await Promise.all(fetchPromises);
        let combinedVttText = 'WEBVTT\n\n';
        let segmentsFetchedCount = 0;

        for (const segmentText of segmentTexts) {
            if (segmentText) {
                segmentsFetchedCount++;
                // Remove WEBVTT header from individual segments
                const cleanedSegment = segmentText
                    .replace(/^WEBVTT\s*/i, '')
                    .trim();
                if (cleanedSegment) {
                    combinedVttText += cleanedSegment + '\n\n';
                }
            }
        }

        if (segmentsFetchedCount === 0 && segmentUrls.length > 0) {
            const error = new Error(
                `Failed to fetch any of the ${segmentUrls.length} VTT segments.`
            );
            this.logger.error('No VTT segments could be fetched', error, {
                segmentCount: segmentUrls.length,
            });
            throw error;
        }

        this.logger.info('VTT segments combined successfully', {
            segmentsFetched: segmentsFetchedCount,
            totalSegments: segmentUrls.length,
            combinedLength: combinedVttText.length,
        });

        return combinedVttText;
    }

    /**
     * Process M3U8 playlist and return combined VTT content
     * @param {string} playlistUrl - M3U8 playlist URL
     * @returns {Promise<string>} Combined VTT content
     */
    async processM3U8Playlist(playlistUrl) {
        this.logger.info('Processing M3U8 playlist');

        try {
            // Fetch the playlist
            const response = await fetchWithTimeout(playlistUrl);
            if (!response.ok) {
                throw new Error(
                    `M3U8 playlist fetch failed: ${response.status}`
                );
            }
            const playlistText = await response.text();

            // Parse segment URLs
            const segmentUrls = this.parsePlaylistForVttSegments(
                playlistText,
                playlistUrl
            );

            if (segmentUrls.length === 0) {
                this.logger.warn('No VTT segments found in M3U8 playlist', {
                    playlistLength: playlistText.length,
                    linesCount: playlistText.split('\n').length,
                });

                throw new Error('No VTT segments found in M3U8 playlist.');
            }

            // Fetch and combine segments
            const combinedVtt = await this.fetchAndCombineVttSegments(
                segmentUrls,
                playlistUrl
            );

            this.logger.info('M3U8 playlist processing completed', {
                segmentCount: segmentUrls.length,
                finalVttLength: combinedVtt.length,
            });

            return combinedVtt;
        } catch (error) {
            this.logger.error('M3U8 playlist processing failed', error);
            throw error;
        }
    }

    /**
     * Fetch text content from URL
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} Text content
     */
    async fetchText(url) {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
            throw new Error(`Subtitle fetch failed: ${response.status}`);
        }
        return await response.text();
    }
}

// Export singleton instance
export const vttParser = new VTTParser();
