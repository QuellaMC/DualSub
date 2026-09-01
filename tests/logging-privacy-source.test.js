import fs from 'node:fs';

const sourcePaths = [
    'background/handlers/messageHandler.js',
    'background/parsers/netflixParser.js',
    'background/parsers/ttmlParser.js',
    'background/parsers/vttParser.js',
    'background/services/aiContextService.js',
    'background/services/sidePanelService.js',
    'background/services/subtitleService.js',
    'background/services/translationService.js',
    'content_scripts/aicontext/core/AIContextManager.js',
    'content_scripts/aicontext/ui/events/ModalController.js',
    'content_scripts/aicontext/ui/modal-core.js',
    'content_scripts/aicontext/ui/modal-events.js',
    'content_scripts/aicontext/ui/modal.js',
    'content_scripts/aicontext/utils/selectionPersistence.js',
    'content_scripts/core/BaseContentScript.js',
    'video_platforms/disneyPlusPlatform.js',
    'video_platforms/netflixPlatform.js',
];

const rawContentFieldPattern =
    /\b(?:analysisResult|config|contentPreview|detail|downloadUrl|firstLines|fullErrorText|fullResponse|metadata|newContent|oldContent|originalLine|payload|playlistPreview|playlistUrl|request|response|result|resultPreview|segmentUrls|selectedText|selectedWords|selection|subtitleContent|text|textPreview|tracksData|ttmlSample|url|word)\s*:/;
const rawContentShorthandPattern =
    /[{,]\s*(?:analysisResult|config|contentPreview|detail|downloadUrl|firstLines|fullErrorText|fullResponse|metadata|newContent|oldContent|originalLine|payload|playlistPreview|playlistUrl|request|response|result|resultPreview|segmentUrls|selectedText|selectedWords|selection|subtitleContent|text|textPreview|tracksData|ttmlSample|url|word)\s*(?=[,}])/;
const rawObjectArgumentPattern =
    /,\s*(?:detail|metadata|payload|request|response|result)\s*\)?\s*$/;

function extractLogCalls(source) {
    const calls = [];
    const callStart =
        /(?:\b(?:logger|this\.logger)\.(?:debug|info|warn|error)|\b(?:this\.)?(?:core\.)?_log|\b(?:this\.)?logWithFallback)\s*\(/g;
    for (const match of source.matchAll(callStart)) {
        let depth = 1;
        let quote = null;
        let escaped = false;
        let index = match.index + match[0].length;
        for (; index < source.length && depth > 0; index++) {
            const char = source[index];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quote) {
                    quote = null;
                }
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                quote = char;
            } else if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
            }
        }
        calls.push(source.slice(match.index, index));
    }
    return calls;
}

describe('production logging privacy source guard', () => {
    test.each(sourcePaths)(
        '%s logs metadata, not user content',
        (sourcePath) => {
            const source = fs.readFileSync(
                new URL(`../${sourcePath}`, import.meta.url),
                'utf8'
            );

            for (const logCall of extractLogCalls(source)) {
                expect(logCall).not.toMatch(rawContentFieldPattern);
                expect(logCall).not.toMatch(rawContentShorthandPattern);
                expect(logCall.trim()).not.toMatch(rawObjectArgumentPattern);
            }
        }
    );
});
