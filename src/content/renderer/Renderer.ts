import type { Logger } from '@/shared/logger';
import type {
    MediaScope,
    PlatformAdapter,
    PlatformDescriptor,
} from '../platform/types';
import { childScope } from '../orchestrator/scope';
import { overlayText } from '../overlayText';
import { pairActiveCues, scanActiveCues } from './cueSelect';
import { SessionContainer, type UiRoot } from './domLayer';
import { startFrameLoop } from './frameLoop';
import { resolveLook, type SubtitleLook } from './looks';
import type { RendererState } from './RendererState';
import {
    applyDisplaySettings,
    applySlotVisibility,
    type DisplaySettings,
    type SubtitleElements,
} from './styling';
import { WordLayer, type WordIntent } from './wordLayer';

/** Text stays on screen this long after a style change with no active cue,
 *  so re-styling never flashes the overlay blank. */
const STYLE_GRACE_MS = 800;

/** The size basis of every look: the height of the picture inside the
 *  video element's box (letterbox bars excluded, as the platforms size
 *  their own subtitles), or the viewport's while the element has no box. */
function sizeBasis(video: HTMLVideoElement): number {
    const box = video.getBoundingClientRect();
    if (box.height <= 0) {
        return window.innerHeight;
    }
    const { videoWidth, videoHeight } = video;
    return videoWidth > 0 && videoHeight > 0
        ? Math.min(box.height, (box.width * videoHeight) / videoWidth)
        : box.height;
}

export class Renderer {
    private readonly container: SessionContainer;
    private readonly words: WordLayer;
    private media: MediaScope | null = null;
    private mediaScope: AbortController | null = null;
    private visible = true;
    private interactive = false;
    private platformLook: SubtitleLook | null;

    constructor(
        private readonly deps: {
            state: RendererState;
            adapter: PlatformAdapter;
            descriptor: Pick<
                PlatformDescriptor,
                'look' | 'parseVideoIdFromUrl'
            >;
            /** The viewer's platform appearance, when the page reported it. */
            platformLook: SubtitleLook | null;
            videoId: string;
            uiRoot: UiRoot;
            signal: AbortSignal;
            logger: Logger;
            onNavigationMismatch: () => void;
            onSeek?: () => void;
            /** The original line was repainted under a new render revision. */
            onOriginalPainted?: (renderRevision: number) => void;
            onWordIntent?: (intent: WordIntent) => void;
            wordLanguage?: () => string;
        }
    ) {
        this.container = new SessionContainer(deps.uiRoot);
        this.platformLook = deps.platformLook;
        this.words = new WordLayer({
            language: () => deps.wordLanguage?.() ?? 'und',
            onIntent: (intent) => deps.onWordIntent?.(intent),
        });
    }

    /** Playback time with the user offset applied; null without a clock. */
    get currentTime(): number | null {
        return this.media ? this.playbackTime(this.media) : null;
    }

    /** Builds the overlay for this video; a re-bind starts from a fresh
     *  container so it is styled for the display in force now. */
    attachMedia(media: MediaScope): void {
        this.detachMedia();
        this.media = media;
        this.mediaScope = childScope(this.deps.signal);
        const { signal } = this.mediaScope;
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
            signal
        );
        // Window, fullscreen, player layout, and picture dimension changes
        // all move the size basis.
        const resize = new ResizeObserver(() => this.restyle());
        resize.observe(media.video);
        signal.addEventListener('abort', () => resize.disconnect(), {
            once: true,
        });
        media.video.addEventListener('resize', () => this.restyle(), {
            signal,
        });
        this.render();
    }

    detachMedia(): void {
        this.mediaScope?.abort();
        this.mediaScope = null;
        this.media = null;
        this.container.destroy();
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
        this.restyle();
        this.render();
    }

    setPlatformLook(look: SubtitleLook | null): void {
        if (this.platformLook === look) {
            return;
        }
        this.platformLook = look;
        this.restyle();
        this.render();
    }

    cuesChanged(): void {
        this.deps.state.invalidateMemo();
        this.render();
    }

    /** Paint the original line as clickable words, or as plain text. The
     *  current line is repainted under a new revision either way. */
    setInteractive(interactive: boolean): void {
        if (this.interactive === interactive) {
            return;
        }
        this.interactive = interactive;
        this.container.current?.original.replaceChildren();
        this.words.forget();
        this.deps.state.painted.originalText = '';
        this.deps.state.invalidateMemo();
        this.render();
    }

    setSelectedWords(indices: Iterable<number>): void {
        this.words.setSelected(indices);
    }

    /** While loading, the translated slot carries a placeholder and the
     *  overlay stays up even between cues, so the wait is visibly ours. */
    setLoading(loading: boolean): void {
        this.deps.state.setLoading(loading);
        this.render();
    }

    destroy(): void {
        this.detachMedia();
        this.words.destroy();
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
            state.invalidateMemo();
            this.restyle();
        }
        return elements;
    }

    /** Re-derive every style from the display, its look, and the video's
     *  current size. */
    private restyle(): void {
        const elements = this.container.current;
        const media = this.media;
        if (!elements || !media) {
            return;
        }
        const { state } = this.deps;
        applyDisplaySettings(
            elements,
            state.display,
            this.look(),
            sizeBasis(media.video)
        );
        state.painted.styleAppliedAt = Date.now();
    }

    private look(): SubtitleLook {
        return resolveLook(
            this.deps.state.display.style,
            this.deps.descriptor.look,
            this.platformLook
        );
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
        const loadingText = state.loading
            ? overlayText('subtitleLoading')
            : null;

        if (scan.activeCues.length > 0) {
            const pair = pairActiveCues(scan.activeCues);
            const originalText = pair.original?.original ?? '';
            const translatedText =
                loadingText ??
                pair.translated?.translated ??
                pair.original?.translated ??
                '';
            this.commit(elements, originalText, translatedText);
            state.painted.placeholder = loadingText !== null;
            const displayed = pair.original ?? pair.translated;
            if (displayed) {
                state.painted.cueWindow = {
                    start: displayed.start,
                    end: displayed.end,
                };
            }
        } else if (loadingText !== null) {
            this.commit(elements, '', loadingText);
            state.painted.placeholder = true;
            state.painted.cueWindow = null;
        } else if (state.painted.placeholder) {
            // The placeholder is not a cue: no grace keeps it up once the
            // wait is over.
            this.commit(elements, '', '');
            state.painted.placeholder = false;
            state.painted.cueWindow = null;
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
        const { state } = this.deps;
        const { painted } = state;
        if (painted.originalText !== originalText) {
            state.renderRevision += 1;
            if (this.interactive && originalText !== '') {
                this.words.paint(
                    elements.original,
                    originalText,
                    state.renderRevision
                );
            } else {
                elements.original.textContent = originalText;
                this.words.forget();
            }
            painted.originalText = originalText;
            if (this.interactive) {
                this.deps.onOriginalPainted?.(state.renderRevision);
            }
        }
        if (painted.translatedText !== translatedText) {
            elements.translated.textContent = translatedText;
            painted.translatedText = translatedText;
        }
        applySlotVisibility(elements);
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
