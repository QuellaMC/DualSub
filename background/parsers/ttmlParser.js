/**
 * TTML to VTT Parser
 *
 * Converts Netflix TTML subtitle format to WebVTT format.
 * Handles region layouts, timing, and text formatting.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';

class TTMLParser {
    constructor() {
        this.logger = loggingManager.createLogger('TTMLParser');
    }

    /**
     * Convert TTML text to VTT format
     * @param {string} ttmlText - The TTML formatted text
     * @returns {string} VTT formatted text
     */
    convertTtmlToVtt(ttmlText) {
        this.logger.debug('Starting TTML to VTT conversion', {
            inputLength: ttmlText.length,
        });

        let vtt = 'WEBVTT\n\n';

        try {
            // Step 1: Parse region layouts to get their x/y coordinates
            this.logger.debug('Step 1: Parsing region layouts');
            const regionLayouts = this.parseRegionLayouts(ttmlText);
            this.logger.debug('Found regions with layout info', {
                regionCount: regionLayouts.size,
            });

            // Step 2: Parse all <p> tags into an intermediate structure
            this.logger.debug('Step 2: Parsing <p> elements');
            const intermediateCues = this.parsePElements(ttmlText);
            this.logger.debug('Parsed p elements into intermediate cues', {
                intermediateCueCount: intermediateCues.length,
            });

            if (intermediateCues.length === 0) {
                this.logger.error('No valid TTML subtitle entries found');
                throw new Error('No valid TTML subtitle entries found');
            }

            // Step 3: Group cues by their timestamp
            this.logger.debug('Step 3: Grouping cues by timestamp');
            const groupedByTime = this.groupCuesByTime(intermediateCues);
            this.logger.debug('Grouped into unique time segments', {
                segmentCount: groupedByTime.size,
            });

            // Step 4: Sort by position and merge into final cues
            this.logger.debug('Step 4: Sorting by position and merging');
            const finalCues = this.createFinalCues(
                groupedByTime,
                regionLayouts
            );
            this.logger.debug('Created final merged cues', {
                finalCueCount: finalCues.length,
            });

            // Step 5: Sort by time and build VTT string
            this.logger.debug('Step 5: Sorting by time and building VTT');
            vtt += this.buildVttString(finalCues);

            this.logger.info('TTML to VTT conversion complete', {
                finalCueCount: finalCues.length,
                vttLength: vtt.length,
                timeRange:
                    finalCues.length > 0
                        ? `${this.convertTtmlTimeToVtt(finalCues[0].begin)} to ${this.convertTtmlTimeToVtt(finalCues[finalCues.length - 1].end)}`
                        : 'N/A',
            });

            return vtt;
        } catch (error) {
            this.logger.error('Error converting TTML to VTT', error, {
                ttmlSample: ttmlText.substring(0, 500),
            });
            throw new Error(`TTML conversion failed: ${error.message}`);
        }
    }

    /**
     * Parse region layouts from TTML
     * @param {string} ttmlText - TTML text
     * @returns {Map} Region layouts map
     */
    parseRegionLayouts(ttmlText) {
        const regionLayouts = new Map();
        const regionRegex =
            /<region\s+xml:id="([^"]+)"[^>]*\s+tts:origin="([^"]+)"/gi;
        let regionMatch;
        let regionCount = 0;

        while ((regionMatch = regionRegex.exec(ttmlText)) !== null) {
            const regionId = regionMatch[1];
            const origin = regionMatch[2].split(' ');
            if (origin.length === 2) {
                const x = parseFloat(origin[0]);
                const y = parseFloat(origin[1]);
                regionLayouts.set(regionId, { x, y });
                regionCount++;
                this.logger.debug('Region layout parsed', {
                    regionId,
                    x,
                    y,
                });
            }
        }

        return regionLayouts;
    }

    /**
     * Parse <p> elements from TTML
     * @param {string} ttmlText - TTML text
     * @returns {Array} Array of intermediate cues
     */
    parsePElements(ttmlText) {
        const intermediateCues = [];
        const pElementRegex =
            /<p[^>]*\s+begin="([^"]+)"[^>]*\s+end="([^"]+)"[^>]*\s+region="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
        let pMatch;
        let pElementCount = 0;

        while ((pMatch = pElementRegex.exec(ttmlText)) !== null) {
            const [_, begin, end, region, textContent] = pMatch;
            pElementCount++;

            let text = textContent
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]*>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            intermediateCues.push({ begin, end, region, text });

            if (pElementCount <= 5) {
                this.logger.debug('Parsed cue', {
                    cueNumber: pElementCount,
                    begin,
                    end,
                    region,
                    textPreview:
                        text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                });
            }
        }

        return intermediateCues;
    }

    /**
     * Group cues by timestamp
     * @param {Array} intermediateCues - Intermediate cues
     * @returns {Map} Grouped cues by time
     */
    groupCuesByTime(intermediateCues) {
        const groupedByTime = new Map();

        for (const cue of intermediateCues) {
            const key = `${cue.begin}-${cue.end}`;
            if (!groupedByTime.has(key)) {
                groupedByTime.set(key, []);
            }
            groupedByTime.get(key).push(cue);
        }

        return groupedByTime;
    }

    /**
     * Create final cues from grouped cues
     * @param {Map} groupedByTime - Grouped cues
     * @param {Map} regionLayouts - Region layouts
     * @returns {Array} Final cues
     */
    createFinalCues(groupedByTime, regionLayouts) {
        const finalCues = [];
        let mergedCount = 0;

        for (const [key, group] of groupedByTime.entries()) {
            // Sort the group based on region position (top-to-bottom, then left-to-right)
            group.sort((a, b) => {
                const regionA = regionLayouts.get(a.region) || {
                    y: 999,
                    x: 999,
                };
                const regionB = regionLayouts.get(b.region) || {
                    y: 999,
                    x: 999,
                };

                // Primary sort: Y-coordinate (top to bottom)
                if (regionA.y < regionB.y) return -1;
                if (regionA.y > regionB.y) return 1;

                // Secondary sort: X-coordinate (left to right)
                if (regionA.x < regionB.x) return -1;
                if (regionA.x > regionB.x) return 1;

                return 0;
            });

            // Merge the text of the now-sorted group
            const mergedText = group
                .map((cue) => cue.text)
                .join(' ')
                .trim();

            const [begin, end] = key.split('-');
            finalCues.push({
                begin,
                end,
                text: mergedText,
            });

            mergedCount++;
            if (mergedCount <= 3) {
                this.logger.debug('Merged cues', {
                    groupSize: group.length,
                    textPreview:
                        mergedText.substring(0, 80) +
                        (mergedText.length > 80 ? '...' : ''),
                });
            }
        }

        return finalCues;
    }

    /**
     * Build VTT string from final cues
     * @param {Array} finalCues - Final cues
     * @returns {string} VTT content
     */
    buildVttString(finalCues) {
        // Sort the final, merged cues by start time
        finalCues.sort((a, b) => parseInt(a.begin) - parseInt(b.begin));

        let vttContent = '';
        let vttCueCount = 0;

        for (const cue of finalCues) {
            const startTime = this.convertTtmlTimeToVtt(cue.begin);
            const endTime = this.convertTtmlTimeToVtt(cue.end);

            vttContent += `${startTime} --> ${endTime}\n`;
            vttContent += `${cue.text}\n\n`;
            vttCueCount++;

            if (vttCueCount <= 3) {
                this.logger.debug('VTT Cue created', {
                    cueNumber: vttCueCount,
                    startTime,
                    endTime,
                    textPreview:
                        cue.text.substring(0, 60) +
                        (cue.text.length > 60 ? '...' : ''),
                });
            }
        }

        return vttContent;
    }

    /**
     * Convert TTML time format to VTT time format
     * @param {string} ttmlTime - TTML time string
     * @returns {string} VTT time string
     */
    convertTtmlTimeToVtt(ttmlTime) {
        // Handle Netflix's tick-based time format (e.g., "107607500t")
        if (ttmlTime.endsWith('t')) {
            const ticks = parseInt(ttmlTime.slice(0, -1));
            const tickRate = 10000000; // Netflix uses 10,000,000 ticks per second
            const seconds = ticks / tickRate;

            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            // Format as HH:MM:SS.mmm
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
        }

        // Handle standard time format: 00:00:01.500 or 00:00:01,500
        // VTT format: 00:00:01.500
        return ttmlTime.replace(',', '.');
    }
}

// Export singleton instance
export const ttmlParser = new TTMLParser();
