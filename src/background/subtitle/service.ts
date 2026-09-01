import { createLogger } from '@/shared/logger';
import { normalizeLanguageCode } from '@/shared/languageNormalization';
import { configService } from '@/config/service';
import { fetchAuthorizedSubtitleText } from './fetch';
import type {
    AuthorizedSubtitleRequest,
    DisneyAuthorizedRequest,
} from './policy';
import {
    MAX_M3U8_PLAYLIST_BYTES,
    processM3U8PlaylistText,
} from './parsers/m3u8';
import { isCallerAbortError, processNetflixSubtitles } from './parsers/netflix';

export interface SubtitleProcessingResult {
    vttText: string;
    targetVttText: string | null;
    sourceLanguage: string;
    targetLanguage: string;
    useNativeTarget: boolean;
    selectedLanguage: { normalizedCode: string; displayName: string };
}

export type DisneyFailureStage =
    'master-fetch' | 'master-parse' | 'media-fetch' | 'vtt-fetch';

/** A Disney pipeline failure tagged with its allowlisted stage metadata. */
export class DisneySubtitleError extends Error {
    override readonly name = 'DisneySubtitleError';
    readonly stage: DisneyFailureStage;
    readonly errorCode: string;

    constructor(stage: DisneyFailureStage, cause: unknown) {
        super('Disney+ subtitle processing failed.', { cause });
        this.stage = stage;
        this.errorCode = `DISNEY_${stage.toUpperCase().replace('-', '_')}_FAILED`;
    }
}

const logger = createLogger('SubtitleService');

interface AvailableSubtitleLanguage {
    normalizedCode: string;
    displayName: string;
    uri: string;
    originalCode: string;
}

function isSubtitleBlacklisted(
    displayName: string,
    line: string,
    blacklist: readonly string[]
): boolean {
    const displayNameLower = displayName.toLowerCase();
    for (const keyword of blacklist) {
        const keywordLower = keyword.toLowerCase().trim();
        if (!keywordLower) {
            continue;
        }
        if (displayNameLower.includes(keywordLower)) {
            return true;
        }
        // Attribute patterns (containing '=') match against the full line, so
        // the keyword "forced=yes" cannot match "FORCED=NO" by name alone.
        if (
            keywordLower.includes('=') &&
            line.toLowerCase().includes(keywordLower)
        ) {
            return true;
        }
    }
    return false;
}

async function parseAvailableSubtitleLanguages(
    masterPlaylistText: string
): Promise<AvailableSubtitleLanguage[]> {
    const blacklistConfig = await configService.get('subtitleBlacklist');
    const platformBlacklist = blacklistConfig?.disneyplus ?? [];

    const languages: AvailableSubtitleLanguage[] = [];
    for (const rawLine of masterPlaylistText.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
            continue;
        }
        const languageMatch = /LANGUAGE="([^"]+)"/.exec(line);
        const nameMatch = /NAME="([^"]+)"/.exec(line);
        const uriMatch = /URI="([^"]+)"/.exec(line);
        if (!languageMatch || !nameMatch || !uriMatch) {
            continue;
        }
        const displayName = nameMatch[1]!;
        if (isSubtitleBlacklisted(displayName, line, platformBlacklist)) {
            continue;
        }
        languages.push({
            normalizedCode: normalizeLanguageCode(languageMatch[1]),
            displayName,
            uri: uriMatch[1]!,
            originalCode: languageMatch[1]!,
        });
    }
    return languages;
}

function findSubtitleUriForLanguage(
    availableLanguages: readonly AvailableSubtitleLanguage[],
    targetLanguageCode: string
): AvailableSubtitleLanguage | null {
    const normalizedTarget = normalizeLanguageCode(targetLanguageCode);
    return (
        availableLanguages.find(
            (lang) => lang.normalizedCode === normalizedTarget
        ) ??
        availableLanguages.find(
            (lang) =>
                lang.normalizedCode.startsWith(normalizedTarget) ||
                normalizedTarget.startsWith(lang.normalizedCode)
        ) ??
        null
    );
}

async function fetchLanguageSpecificSubtitles(
    snapshot: DisneyAuthorizedRequest,
    uri: string,
    baseCanonicalUrl: string,
    signal: AbortSignal | undefined
): Promise<string> {
    let mediaPlaylist: { text: string; canonicalUrl: string };
    try {
        mediaPlaylist = await fetchAuthorizedSubtitleText(snapshot, uri, {
            baseUrl: baseCanonicalUrl,
            stage: 'disney-language',
            signal,
            maxBytes: MAX_M3U8_PLAYLIST_BYTES,
        });
    } catch (error) {
        if (isCallerAbortError(error)) {
            throw error;
        }
        throw new DisneySubtitleError('media-fetch', error);
    }

    const { text: subtitleText, canonicalUrl } = mediaPlaylist;
    if (subtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
        return subtitleText;
    }
    if (subtitleText.trim().startsWith('#EXTM3U')) {
        try {
            return await processM3U8PlaylistText(
                snapshot,
                subtitleText,
                canonicalUrl,
                { signal }
            );
        } catch (error) {
            if (isCallerAbortError(error)) {
                throw error;
            }
            throw new DisneySubtitleError('vtt-fetch', error);
        }
    }
    throw new DisneySubtitleError(
        'media-fetch',
        new Error('Content from subtitle playlist URI was not M3U8 or VTT.')
    );
}

export async function processDisneyPlusSubtitles(
    snapshot: DisneyAuthorizedRequest,
    options: { signal?: AbortSignal } = {}
): Promise<SubtitleProcessingResult> {
    const { targetLanguage, originalLanguage } = snapshot;
    const signal = options.signal;

    let masterPlaylist: { text: string; canonicalUrl: string };
    try {
        masterPlaylist = await fetchAuthorizedSubtitleText(
            snapshot,
            snapshot.url,
            {
                stage: 'disney-master',
                signal,
                maxBytes: MAX_M3U8_PLAYLIST_BYTES,
            }
        );
    } catch (error) {
        if (isCallerAbortError(error)) {
            throw error;
        }
        throw new DisneySubtitleError('master-fetch', error);
    }
    const { text: masterPlaylistText, canonicalUrl: masterCanonicalUrl } =
        masterPlaylist;

    if (masterPlaylistText.trim().toUpperCase().startsWith('WEBVTT')) {
        logger.info('Master URL points directly to a VTT file');
        const sourceLanguage = normalizeLanguageCode(originalLanguage);
        return {
            vttText: masterPlaylistText,
            targetVttText: null,
            sourceLanguage,
            targetLanguage: normalizeLanguageCode(targetLanguage),
            useNativeTarget: false,
            selectedLanguage: {
                normalizedCode: sourceLanguage,
                displayName: originalLanguage,
            },
        };
    }

    const lines = masterPlaylistText
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const firstStructuralLine = lines.find(
        (line) => !line.startsWith('#') || line.startsWith('#EXTM3U')
    );
    if (!firstStructuralLine?.startsWith('#EXTM3U')) {
        throw new DisneySubtitleError(
            'master-parse',
            new Error('Content is not a recognized M3U8 playlist or VTT file.')
        );
    }

    const availableLanguages =
        await parseAvailableSubtitleLanguages(masterPlaylistText);
    const useOfficialTranslations = await configService.get(
        'useOfficialTranslations'
    );

    let targetLanguageInfo =
        useOfficialTranslations && targetLanguage
            ? findSubtitleUriForLanguage(availableLanguages, targetLanguage)
            : null;
    let useNativeTarget = targetLanguageInfo !== null;

    const originalLanguageInfo =
        findSubtitleUriForLanguage(availableLanguages, originalLanguage) ??
        findSubtitleUriForLanguage(availableLanguages, 'en') ??
        availableLanguages[0] ??
        null;
    if (!originalLanguageInfo) {
        throw new DisneySubtitleError(
            'master-parse',
            new Error('No suitable subtitle language found.')
        );
    }

    const vttText = await fetchLanguageSpecificSubtitles(
        snapshot,
        originalLanguageInfo.uri,
        masterCanonicalUrl,
        signal
    );

    let targetVttText: string | null = null;
    if (useNativeTarget && targetLanguageInfo) {
        try {
            targetVttText = await fetchLanguageSpecificSubtitles(
                snapshot,
                targetLanguageInfo.uri,
                masterCanonicalUrl,
                signal
            );
        } catch (error) {
            if (isCallerAbortError(error)) {
                throw error;
            }
            targetLanguageInfo = null;
            useNativeTarget = false;
            logger.warn(
                'Official Disney+ target subtitles unavailable; using original subtitles',
                { stage: 'official-target' }
            );
        }
    }

    return {
        vttText,
        targetVttText: useNativeTarget ? targetVttText : null,
        sourceLanguage: normalizeLanguageCode(
            originalLanguageInfo.normalizedCode
        ),
        targetLanguage: normalizeLanguageCode(targetLanguage),
        useNativeTarget,
        selectedLanguage: {
            normalizedCode: originalLanguageInfo.normalizedCode,
            displayName: originalLanguageInfo.displayName,
        },
    };
}

/** Route an authorized request to its platform pipeline. */
export async function processSubtitleRequest(
    snapshot: AuthorizedSubtitleRequest,
    options: { signal?: AbortSignal } = {}
): Promise<SubtitleProcessingResult> {
    return snapshot.source === 'netflix'
        ? processNetflixSubtitles(snapshot, options)
        : processDisneyPlusSubtitles(snapshot, options);
}
