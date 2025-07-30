/**
 * VTT Parser with M3U8 Support
 * 
 * Integrates with shared VTT parsing utilities and adds M3U8 playlist
 * parsing capabilities for segmented subtitle files.
 * 
 * Reuses existing parseVTT() and parseTimestampToSeconds() from shared utilities.
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { sharedUtilityIntegration } from '../utils/sharedUtilityIntegration.js';
import { loggingManager } from '../utils/loggingManager.js';

class VTTParser {
    constructor() {
        this.logger = loggingManager.createLogger('VTTParser');
    }

    /**
     * Parse VTT content using shared utilities
     * @param {string} vttString - VTT content
     * @returns {Array} Array of parsed cues
     */
    parseVTT(vttString) {
        this.logger.debug('Parsing VTT content', {
            contentLength: vttString.length,
        });

        return sharedUtilityIntegration.parseVTT(vttString, {
            enableCache: true
        });
    }

    /**
     * Parse timestamp to seconds using shared utilities
     * @param {string} timestamp - Timestamp string
     * @returns {number} Seconds
     */
    parseTimestampToSeconds(timestamp) {
        return sharedUtilityIntegration.parseTimestampToSeconds(timestamp, {
            enableCache: true
        });
    }

    /**
     * Parse M3U8 playlist to extract VTT segment URLs
     * @param {string} playlistText - M3U8 playlist content
     * @param {string} playlistUrl - Base URL for resolving relative URLs
     * @returns {Array} Array of segment URLs
     */
    parsePlaylistForVttSegments(playlistText, playlistUrl) {
        this.logger.debug('Parsing M3U8 playlist for VTT segments', {
            playlistUrl,
            contentLength: playlistText.length,
        });

        const lines = playlistText.split('\n');
        const segmentUrls = [];
        const baseUrl = new URL(playlistUrl);

        // Log the first few lines for debugging
        this.logger.debug('M3U8 playlist content preview', {
            firstLines: lines.slice(0, 10),
            totalLines: lines.length
        });

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                this.logger.debug('Processing M3U8 line', {
                    line: trimmedLine,
                    hasVtt: trimmedLine.toLowerCase().includes('.vtt'),
                    hasWebvtt: trimmedLine.toLowerCase().includes('.webvtt'),
                    hasSlash: trimmedLine.includes('/'),
                    length: trimmedLine.length
                });

                // Enhanced check for subtitle segments
                // Include Disney+ style segments and other common patterns
                if (
                    trimmedLine.toLowerCase().includes('.vtt') ||
                    trimmedLine.toLowerCase().includes('.webvtt') ||
                    trimmedLine.toLowerCase().includes('subtitle') ||
                    trimmedLine.toLowerCase().includes('caption') ||
                    // Disney+ segments often don't have extensions but are subtitle URLs
                    (trimmedLine.includes('disney') && trimmedLine.includes('subtitle')) ||
                    // Generic segment pattern (not just files without /)
                    (!trimmedLine.includes('?') && trimmedLine.length > 5)
                ) {
                    try {
                        const segmentUrl = new URL(trimmedLine, baseUrl.href).href;
                        segmentUrls.push(segmentUrl);
                        this.logger.debug('Found VTT segment', {
                            segmentUrl,
                            originalLine: trimmedLine,
                        });
                    } catch (error) {
                        this.logger.warn('Could not form valid URL from M3U8 line', error, {
                            line: trimmedLine,
                            baseUrl: baseUrl.href,
                        });
                    }
                } else {
                    this.logger.debug('Skipped M3U8 line (no match)', {
                        line: trimmedLine.substring(0, 100) + (trimmedLine.length > 100 ? '...' : '')
                    });
                }
            }
        }

        this.logger.info('M3U8 playlist parsing completed', {
            segmentCount: segmentUrls.length,
            playlistUrl,
        });

        return segmentUrls;
    }

    /**
     * Fetch and combine VTT segments from URLs
     * @param {Array} segmentUrls - Array of segment URLs
     * @param {string} playlistUrlForLogging - Original playlist URL for logging
     * @returns {Promise<string>} Combined VTT content
     */
    async fetchAndCombineVttSegments(segmentUrls, playlistUrlForLogging = 'N/A') {
        this.logger.info('Fetching VTT segments from playlist', {
            segmentCount: segmentUrls.length,
            playlistUrl: playlistUrlForLogging,
        });

        const fetchPromises = segmentUrls.map(async (url) => {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status} for ${url}`);
                }
                return await response.text();
            } catch (error) {
                this.logger.warn('Error fetching VTT segment', error, { url });
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
                segmentUrls: segmentUrls.slice(0, 3), // Log first 3 URLs for debugging
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
        this.logger.info('Processing M3U8 playlist', { playlistUrl });

        try {
            // Fetch the playlist
            const response = await fetch(playlistUrl);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} for playlist ${playlistUrl}`);
            }
            const playlistText = await response.text();

            // Parse segment URLs
            const segmentUrls = this.parsePlaylistForVttSegments(playlistText, playlistUrl);
            
            if (segmentUrls.length === 0) {
                this.logger.warn('No VTT segments found in M3U8 playlist', {
                    playlistUrl,
                    playlistLength: playlistText.length,
                    linesCount: playlistText.split('\n').length,
                    playlistPreview: playlistText.substring(0, 500)
                });

                // Try to treat the entire URL as a direct VTT file
                this.logger.info('Attempting to treat URL as direct VTT file');
                const directVttResponse = await fetch(playlistUrl);
                if (directVttResponse.ok) {
                    const directVttContent = await directVttResponse.text();
                    this.logger.info('Successfully fetched direct VTT content', {
                        contentLength: directVttContent.length
                    });
                    return directVttContent;
                } else {
                    throw new Error(`No VTT segments found and direct VTT fetch failed: ${directVttResponse.status}`);
                }
            }

            // Fetch and combine segments
            const combinedVtt = await this.fetchAndCombineVttSegments(segmentUrls, playlistUrl);
            
            this.logger.info('M3U8 playlist processing completed', {
                playlistUrl,
                segmentCount: segmentUrls.length,
                finalVttLength: combinedVtt.length,
            });

            return combinedVtt;
        } catch (error) {
            this.logger.error('M3U8 playlist processing failed', error, {
                playlistUrl,
            });
            throw error;
        }
    }

    /**
     * Fetch text content from URL
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} Text content
     */
    async fetchText(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status} for ${url}`);
        }
        return await response.text();
    }
}

// Export singleton instance
export const vttParser = new VTTParser();
