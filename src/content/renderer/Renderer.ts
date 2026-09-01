import type { Logger } from '@/shared/logger';
import type {
    MediaScope,
    PlatformAdapter,
    PlatformDescriptor,
} from '../platform/types';
import { childScope } from '../orchestrator/scope';
import { pairActiveCues, scanActiveCues } from './cueSelect';
import { SessionContainer, type UiRoot } from './domLayer';
import { startFrameLoop } from './frameLoop';
import type { RendererState } from './RendererState';
import {
    applyDisplaySettings,
    type DisplaySettings,
    type SubtitleElements,
} from './styling';

/** Text stays on screen this long after a style change with no active cue,
 *  so re-styling never flashes the overlay blank. */
const STYLE_GRACE_MS = 800;

export class Renderer {
    private readonly container: SessionContainer;
    private media: MediaScope | null = null;
    private mediaScope: AbortController | null = null;
    private visible = true;

    constructor(
        private readonly deps: {
            state: RendererState;
            adapter: PlatformAdapter;
            descriptor: Pick<PlatformDescriptor, 'parseVideoIdFromUrl'>;
            videoId: string;
            uiRoot: UiRoot;
            signal: AbortSignal;
            logger: Logger;
            onNavigationMismatch: () => void;
            onSeek?: () => void;
        }
    ) {
        this.container = new SessionContainer(deps.uiRoot);
    }

    /** Playback time with the user offset applied; null without a clock. */
    get currentTime(): number | null {
        return this.media ? this.playbackTime(this.media) : null;
    }

    attachMedia(media: MediaScope): void {
        this.detachMedia();
        this.media = media;
        this.mediaScope = childScope(this.deps.signal);
        this.ensureElements(media);
        startFrameLoop(
            media.video,
            {
                onFrame: () => this.frame(),
                onSeek: () => {
                    this.deps.adapter.onClockInvalidated();
                    this.deps.state.invalidateMemo();
                    this.deps.onSeek?.();
                },
            },
            this.mediaScope.signal
        );
        this.render();
    }

    detachMedia(): void {
        this.mediaScope?.abort();
        this.mediaScope = null;
        this.media = null;
        this.hide();
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (!visible) {
            this.hide();
            return;
        }
        this.deps.state.invalidateMemo();
        this.render();
    }

    setDisplay(display: DisplaySettings): void {
        this.deps.state.setDisplay(display);
        const elements = this.container.current;
        if (elements) {
            applyDisplaySettings(elements, display);
            this.deps.state.painted.styleAppliedAt = Date.now();
        }
        this.render();
    }

    cuesChanged(): void {
        this.deps.state.invalidateMemo();
        this.render();
    }

    destroy(): void {
        this.detachMedia();
        this.container.destroy();
    }

    private playbackTime(media: MediaScope): number | null {
        const raw = this.deps.adapter.getPlaybackTime(media.video);
        return raw === null ? null : raw + this.deps.state.display.timeOffset;
    }

    /** Live elements; a rebuild resets painted text so the next commit paints. */
    private ensureElements(media: MediaScope): SubtitleElements {
        const { state } = this.deps;
        const epochBefore = this.container.containerEpoch;
        const elements = this.container.ensure(media);
        if (this.container.containerEpoch !== epochBefore) {
            state.painted.originalText = '';
            state.painted.translatedText = '';
            applyDisplaySettings(elements, state.display);
            state.painted.styleAppliedAt = Date.now();
            state.invalidateMemo();
        }
        return elements;
    }

    private frame(): void {
        const media = this.media;
        if (!media || !this.visible) {
            return;
        }
        const elements = this.container.current;
        if (elements && !elements.container.isConnected) {
            this.render();
            return;
        }
        if (media.video.readyState < media.video.HAVE_CURRENT_DATA) {
            return;
        }
        const time = this.playbackTime(media);
        if (time === null) {
            this.hide();
            this.deps.state.invalidateMemo();
            return;
        }
        if (
            this.deps.state.shouldRender(
                time,
                location.href,
                this.container.containerEpoch,
                media.video,
                Date.now()
            )
        ) {
            this.render();
        }
    }

    private render(): void {
        const { state, descriptor, videoId } = this.deps;
        const media = this.media;
        if (!media || !this.visible) {
            this.hide();
            return;
        }
        const time = this.playbackTime(media);
        if (time === null) {
            this.hide();
            state.invalidateMemo();
            return;
        }
        const href = location.href;

        // Belt-and-braces navigation guard: never paint this session's cues
        // over a route that belongs to another video.
        if (descriptor.parseVideoIdFromUrl(href) !== videoId) {
            this.hide();
            state.invalidateMemo();
            this.deps.onNavigationMismatch();
            return;
        }

        const elements = this.ensureElements(media);
        const scan = scanActiveCues(state.cues, time);
        const now = Date.now();
        let { nextBoundaryTime, nextBoundaryInclusive } = scan;
        let wallClockDeadline: number | null = null;

        if (scan.activeCues.length > 0) {
            const pair = pairActiveCues(scan.activeCues);
            const originalText = pair.original?.original ?? '';
            const translatedText =
                pair.translated?.translated ?? pair.original?.translated ?? '';
            this.commit(elements, originalText, translatedText);
            const displayed = pair.original ?? pair.translated;
            if (displayed) {
                state.painted.cueWindow = {
                    start: displayed.start,
                    end: displayed.end,
                };
            }
        } else {
            const cueWindow = state.painted.cueWindow;
            const withinWindow =
                cueWindow !== null &&
                time >= cueWindow.start &&
                time <= cueWindow.end;
            const graceDeadline = state.painted.styleAppliedAt + STYLE_GRACE_MS;
            const hasText =
                state.painted.originalText !== '' ||
                state.painted.translatedText !== '';
            if (withinWindow) {
                if (
                    nextBoundaryTime === null ||
                    cueWindow.end < nextBoundaryTime
                ) {
                    nextBoundaryTime = cueWindow.end;
                    nextBoundaryInclusive = false;
                }
            } else if (hasText && now < graceDeadline) {
                wallClockDeadline = graceDeadline;
            } else {
                this.commit(elements, '', '');
                state.painted.cueWindow = null;
            }
        }

        this.show(elements);
        state.frameMemo = {
            evaluatedTime: time,
            nextBoundaryTime,
            nextBoundaryInclusive,
            wallClockDeadline,
            href,
            containerEpoch: this.container.containerEpoch,
            video: media.video,
        };
    }

    private commit(
        elements: SubtitleElements,
        originalText: string,
        translatedText: string
    ): void {
        const { painted } = this.deps.state;
        if (painted.originalText !== originalText) {
            elements.original.textContent = originalText;
            painted.originalText = originalText;
            this.deps.state.renderRevision += 1;
        }
        if (painted.translatedText !== translatedText) {
            elements.translated.textContent = translatedText;
            painted.translatedText = translatedText;
        }
    }

    private show(elements: SubtitleElements): void {
        elements.container.style.display = 'flex';
    }

    private hide(): void {
        const elements = this.container.current;
        if (elements) {
            elements.container.style.display = 'none';
        }
    }
}
