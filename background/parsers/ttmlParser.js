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
        if (typeof ttmlText !== 'string' || ttmlText.trim() === '') {
            throw new Error('TTML input must be a non-empty string');
        }
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
                inputLength: ttmlText.length,
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
        const regionRegex = /<(?:[\w-]+:)?region\b([^>]*)\/?\s*>/gi;
        let regionMatch;

        while ((regionMatch = regionRegex.exec(ttmlText)) !== null) {
            const attributes = this.parseAttributes(regionMatch[1]);
            const regionId = attributes['xml:id'] || attributes.id;
            const origin = String(attributes['tts:origin'] || '').split(/\s+/);
            if (origin.length === 2) {
                const x = parseFloat(origin[0]);
                const y = parseFloat(origin[1]);
                if (!regionId || !Number.isFinite(x) || !Number.isFinite(y)) {
                    continue;
                }
                regionLayouts.set(regionId, { x, y });
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
            /<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p>/gi;
        let pMatch;
        let pElementCount = 0;

        while ((pMatch = pElementRegex.exec(ttmlText)) !== null) {
            const attributes = this.parseAttributes(pMatch[1]);
            const begin = attributes.begin;
            const end = attributes.end;
            const region = attributes.region || '';
            const textContent = pMatch[2];
            if (!begin || !end) {
                continue;
            }
            pElementCount++;

            const text = this.decodeEntities(
                textContent
                    .replace(/<br\s*\/?>/gi, ' ')
                    .replace(/<[^>]*>/g, '')
                    .replace(/\r?\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
            );

            intermediateCues.push({ begin, end, region, text });

            if (pElementCount <= 5) {
                this.logger.debug('Parsed cue', {
                    cueNumber: pElementCount,
                    begin,
                    end,
                    region,
                    textLength: text.length,
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
            const key = JSON.stringify([cue.begin, cue.end]);
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

            const [begin, end] = JSON.parse(key);
            finalCues.push({
                begin,
                end,
                text: mergedText,
            });

            mergedCount++;
            if (mergedCount <= 3) {
                this.logger.debug('Merged cues', {
                    groupSize: group.length,
                    textLength: mergedText.length,
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
        finalCues.sort(
            (a, b) =>
                this.parseTtmlTimeToSeconds(a.begin) -
                this.parseTtmlTimeToSeconds(b.begin)
        );

        let vttContent = '';
        let vttCueCount = 0;

        for (const cue of finalCues) {
            const startSeconds = this.parseTtmlTimeToSeconds(cue.begin);
            const endSeconds = this.parseTtmlTimeToSeconds(cue.end);
            if (
                Number.isFinite(startSeconds) &&
                Number.isFinite(endSeconds) &&
                endSeconds <= startSeconds
            ) {
                throw new Error(
                    `Invalid TTML cue range: ${cue.begin} to ${cue.end}`
                );
            }
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
                    textLength: cue.text.length,
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
        const seconds = this.parseTtmlTimeToSeconds(ttmlTime);
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error(`Unsupported TTML timestamp: ${ttmlTime}`);
        }
        return this.formatSecondsAsVtt(seconds);
    }

    parseAttributes(attributeText) {
        const attributes = Object.create(null);
        const attributeRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let match;
        while ((match = attributeRegex.exec(attributeText)) !== null) {
            attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
        }
        return attributes;
    }

    decodeEntities(text) {
        return text
            .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
                String.fromCodePoint(Number.parseInt(hex, 16))
            )
            .replace(/&#(\d+);/g, (_match, decimal) =>
                String.fromCodePoint(Number.parseInt(decimal, 10))
            )
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&apos;|&#39;/gi, "'")
            .replace(/&amp;/gi, '&');
    }

    parseTtmlTimeToSeconds(ttmlTime) {
        const value = String(ttmlTime).trim().replace(',', '.');
        const tickMatch = value.match(/^(\d+(?:\.\d+)?)t$/i);
        if (tickMatch) {
            return Number(tickMatch[1]) / 10_000_000;
        }

        const clockMatch = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
        if (clockMatch) {
            const minutes = Number(clockMatch[2]);
            const seconds = Number(clockMatch[3]);
            if (minutes >= 60 || seconds >= 60) {
                return Number.NaN;
            }
            return Number(clockMatch[1]) * 3600 + minutes * 60 + seconds;
        }

        const offsetMatch = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/i);
        if (!offsetMatch) {
            return Number.NaN;
        }
        const amount = Number(offsetMatch[1]);
        const multipliers = { h: 3600, m: 60, s: 1, ms: 0.001 };
        return amount * multipliers[offsetMatch[2].toLowerCase()];
    }

    formatSecondsAsVtt(seconds) {
        const totalMilliseconds = Math.round(seconds * 1000);
        const hours = Math.floor(totalMilliseconds / 3_600_000);
        const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
        const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
        const milliseconds = totalMilliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    }
}

// Export singleton instance
export const ttmlParser = new TTMLParser();
