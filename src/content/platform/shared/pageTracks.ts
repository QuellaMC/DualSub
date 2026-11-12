import { isSameLanguage } from '@/shared/languageNormalization';
import { PLATFORM_NAMES } from '@/shared/platforms';
import type { CapturedEvent } from '../../bridge/protocol';
import type {
    AdapterContext,
    PageTrackSource,
    SubtitleLanguages,
    SubtitleSource,
} from '../types';

/** Languages the page bridge should resolve, original first. The target is
 *  only wanted when official translations may replace API translation, and
 *  never when it is the original's own language. */
export function requestedSubtitleLanguages(
    languages: SubtitleLanguages
): string[] {
    const { originalLanguage, targetLanguage } = languages;
    return languages.useOfficialTranslations &&
        !isSameLanguage(originalLanguage, targetLanguage)
        ? [originalLanguage, targetLanguage]
        : [originalLanguage];
}

function sameLanguages(
    left: readonly string[],
    right: readonly string[]
): boolean {
    return (
        left.length === right.length &&
        left.every((language, index) => language === right[index])
    );
}

/**
 * Subtitle tracks the page bridge reads from the platform's own player. The
 * adapter asks once the bridge is up and again whenever the session's
 * languages change; a later ask supersedes an earlier one, and only the
 * answer for the current languages counts.
 */
export class PageTrackRequests {
    constructor(
        private readonly context: AdapterContext,
        private readonly source: PageTrackSource
    ) {}

    /** Waits for concrete languages: an automatic original line needs the
     *  spoken language first. */
    send(): void {
        const languages = this.context.languages();
        if (!languages) {
            return;
        }
        this.context.bridge.sendControl({
            t: 'request-subtitle-tracks',
            videoId: this.context.videoId,
            languages: requestedSubtitleLanguages(languages),
        });
    }

    /** A resolution for other languages answered an earlier request; the
     *  one for the current languages is on its way. */
    interpret(event: CapturedEvent): SubtitleSource | null {
        if (event.t !== 'subtitle-data') {
            return null;
        }
        const languages = this.context.languages();
        if (
            !languages ||
            !sameLanguages(
                event.languages,
                requestedSubtitleLanguages(languages)
            )
        ) {
            return null;
        }
        if (event.tracks.length === 0) {
            this.context.logger.warn(
                `${PLATFORM_NAMES[this.source]} resolved no subtitle track for the requested languages`,
                { videoId: this.context.videoId }
            );
            return { kind: 'unavailable' };
        }
        return {
            kind: 'page-tracks',
            source: this.source,
            tracks: event.tracks,
        };
    }

    cancel(): void {
        this.context.bridge.sendControl({ t: 'cancel-subtitle-tracks' });
    }
}
