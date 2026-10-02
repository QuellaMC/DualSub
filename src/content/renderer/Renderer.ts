import type { Logger } from '@/shared/logger';
import type {
    MediaScope,
    PlatformAdapter,
    PlatformDescriptor,
} from '../platform/types';
import { childScope } from '../orchestrator/scope';
import { overlayText } from '../overlayText';
import type { Cue } from '../subtitles/cueModel';
import {
    blockKey,
    composeBlockText,
    groupActiveCues,
    placementOrder,
    samePlacement,
    scanActiveCues,
    STANDARD_PLACEMENT,
    type BlockPlacement,
} from './cueSelect';
import { SessionContainer, type UiRoot } from './domLayer';
import { startFrameLoop } from './frameLoop';
import { resolveLook, type SubtitleLook } from './looks';
import type { RendererState } from './RendererState';
import {
    applyBlockStyle,
    applySlotVisibility,
    createBlockElements,
    type BlockElements,
    type DisplaySettings,
} from './styling';
import { WordLayer, type WordIntent } from './wordLayer';

/** Text stays on screen this long after a style change with no active cue,
 *  so re-styling never flashes the overlay blank. */
const STYLE_GRACE_MS = 800;

interface PictureRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** The picture inside the video element's box, in viewport coordinates:
 *  letterbox bars excluded, as the platforms place and size their own
 *  subtitles; the viewport itself while the element has no box. */
function pictureRect(video: HTMLVideoElement): PictureRect {
    const box = video.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) {
        return {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    }
    const { videoWidth, videoHeight } = video;
    if (!(videoWidth > 0 && videoHeight > 0)) {
        return {
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
        };
    }
    const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    return {
        left: box.left + (box.width - width) / 2,
        top: box.top + (box.height - height) / 2,
        width,
        height,
    };
}

interface CueWindow {
    readonly start: number;
    readonly end: number;
}

/** One drawn placement: an original line and its translation. */
interface Block {
    readonly key: string;
    readonly elements: BlockElements;
    placement: BlockPlacement;
    originalText: string;
    translatedText: string;
    /** The span of the cues drawn. With nothing to replace it, a block
     *  stays up to its end even when the cues vanish, as across a cue-set
     *  reload. */
    window: CueWindow | null;
    /** Shows the loading placeholder, which gets no grace. */
    placeholder: boolean;
    /** The original line is painted as clickable words. */
    interactive: boolean;
}

interface BlockContent {
    readonly placement: BlockPlacement;
    readonly originalText: string;
    readonly translatedText: string;
    readonly window: CueWindow | null;
    readonly placeholder: boolean;
}

export class Renderer {
    private readonly container: SessionContainer;
    private readonly blocks = new Map<string, Block>();
    private readonly words: WordLayer;
    private media: MediaScope | null = null;
    private mediaScope: AbortController | null = null;
    private pictureHeight = 0;
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
     *  stage so it is styled for the display in force now. */
    attachMedia(media: MediaScope): void {
        this.detachMedia();
        this.media = media;
        this.mediaScope = childScope(this.deps.signal);
        const { signal } = this.mediaScope;
        this.ensureStage();
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
        // all resize the picture; a viewport change or a scroll can move it
        // without resizing it, and every render measures it again.
        const resize = new ResizeObserver(() => this.restyle());
        resize.observe(media.video);
        signal.addEventListener('abort', () => resize.disconnect(), {
            once: true,
        });
        media.video.addEventListener('resize', () => this.restyle(), {
            signal,
        });
        window.addEventListener('resize', () => this.placeStage(), { signal });
        window.addEventListener('scroll', () => this.placeStage(), {
            capture: true,
            passive: true,
            signal,
        });
        this.render();
    }

    detachMedia(): void {
        this.mediaScope?.abort();
        this.mediaScope = null;
        this.media = null;
        this.blocks.clear();
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

    /** Paint the current line as clickable words, or as plain text. It is
     *  repainted under a new revision either way. */
    setInteractive(interactive: boolean): void {
        if (this.interactive === interactive) {
            return;
        }
        this.interactive = interactive;
        this.forgetCurrentLine();
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

    /** The next render reports the current line anew, under a new
     *  revision. */
    private forgetCurrentLine(): void {
        const { state } = this.deps;
        state.painted.currentLine = '';
        state.painted.currentBlock = '';
        state.invalidateMemo();
    }

    /** The live stage; a rebuild forgets every block so the next render
     *  paints afresh. */
    private ensureStage(): HTMLDivElement {
        const epochBefore = this.container.containerEpoch;
        const stage = this.container.ensure();
        if (this.container.containerEpoch !== epochBefore) {
            this.blocks.clear();
            this.forgetCurrentLine();
            this.restyle();
        }
        return stage;
    }

    /** Lay the stage over the picture; its height sizes every block. */
    private placeStage(): number {
        const stage = this.container.current;
        const media = this.media;
        if (!stage || !media) {
            return this.pictureHeight;
        }
        const rect = pictureRect(media.video);
        Object.assign(stage.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
        });
        this.pictureHeight = rect.height;
        return rect.height;
    }

    /** Re-derive every style from the display, its look, and the picture's
     *  current size. */
    private restyle(): void {
        if (!this.container.current || !this.media) {
            return;
        }
        const pictureHeight = this.placeStage();
        for (const block of this.blocks.values()) {
            this.styleBlock(block, pictureHeight);
        }
        this.deps.state.painted.styleAppliedAt = Date.now();
    }

    private styleBlock(block: Block, pictureHeight: number): void {
        applyBlockStyle(
            block.elements,
            this.deps.state.display,
            this.look(),
            pictureHeight,
            block.placement
        );
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
        const stage = this.container.current;
        if (stage && !stage.isConnected) {
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

        const stage = this.ensureStage();
        this.placeStage();
        const scan = scanActiveCues(state.cues, time);
        const now = Date.now();
        let { nextBoundaryTime } = scan;
        let wallClockDeadline: number | null = null;
        const planned = this.plan(
            scan.activeCues,
            state.loading ? overlayText('subtitleLoading') : null
        );

        // A block the plan dropped stays up only while nothing replaces it:
        // to the end of its cue window, or through the restyle grace, so a
        // reload or a style change never flashes the overlay blank. A
        // placeholder goes at once.
        const keepDropped = planned.size === 0;
        const graceDeadline = state.painted.styleAppliedAt + STYLE_GRACE_MS;
        for (const block of [...this.blocks.values()]) {
            if (planned.has(block.key)) {
                continue;
            }
            const cueWindow = block.window;
            if (
                keepDropped &&
                !block.placeholder &&
                cueWindow !== null &&
                time >= cueWindow.start &&
                time < cueWindow.end
            ) {
                if (
                    nextBoundaryTime === null ||
                    cueWindow.end < nextBoundaryTime
                ) {
                    nextBoundaryTime = cueWindow.end;
                }
            } else if (
                keepDropped &&
                !block.placeholder &&
                now < graceDeadline
            ) {
                wallClockDeadline = graceDeadline;
            } else {
                block.elements.container.remove();
                this.blocks.delete(block.key);
            }
        }
        for (const [key, content] of planned) {
            const block =
                this.blocks.get(key) ??
                this.createBlock(key, content.placement);
            if (!block.elements.container.isConnected) {
                stage.appendChild(block.elements.container);
            }
            if (!samePlacement(block.placement, content.placement)) {
                block.placement = content.placement;
                this.styleBlock(block, this.pictureHeight);
            }
            block.window = content.window;
            block.placeholder = content.placeholder;
        }
        this.commit(planned);

        stage.style.display = 'block';
        state.frameMemo = {
            evaluatedTime: time,
            nextBoundaryTime,
            wallClockDeadline,
            href,
            containerEpoch: this.container.containerEpoch,
            video: media.video,
        };
    }

    /** What each placement shows this frame. While loading, every block
     *  carries the placeholder, the standard block alone when no cue is
     *  active. */
    private plan(
        activeCues: readonly Cue[],
        loadingText: string | null
    ): Map<string, BlockContent> {
        const planned = new Map<string, BlockContent>();
        for (const group of groupActiveCues(activeCues)) {
            const text = composeBlockText(group.cues);
            planned.set(group.key, {
                placement: group.placement,
                originalText: text.originalText,
                translatedText: loadingText ?? text.translatedText,
                placeholder: loadingText !== null,
                window: {
                    start: Math.min(...group.cues.map((cue) => cue.start)),
                    end: Math.max(...group.cues.map((cue) => cue.end)),
                },
            });
        }
        if (planned.size === 0 && loadingText !== null) {
            planned.set(blockKey(STANDARD_PLACEMENT), {
                placement: STANDARD_PLACEMENT,
                originalText: '',
                translatedText: loadingText,
                placeholder: true,
                window: null,
            });
        }
        return planned;
    }

    private createBlock(key: string, placement: BlockPlacement): Block {
        const block: Block = {
            key,
            placement,
            elements: createBlockElements(key),
            originalText: '',
            translatedText: '',
            window: null,
            placeholder: false,
            interactive: false,
        };
        this.styleBlock(block, this.pictureHeight);
        this.blocks.set(key, block);
        return block;
    }

    /** Paint every block. The first line with text, in block order, is the
     *  current line: the one painted as clickable words and reported to the
     *  selection under a new revision whenever it or its block changes. */
    private commit(planned: ReadonlyMap<string, BlockContent>): void {
        const { state } = this.deps;
        const blocks = [...this.blocks.values()].sort(
            (a, b) => placementOrder(a.placement) - placementOrder(b.placement)
        );
        const originalTextOf = (block: Block): string =>
            planned.get(block.key)?.originalText ?? block.originalText;
        const primary =
            blocks.find((block) => originalTextOf(block) !== '') ?? null;
        const line = primary ? originalTextOf(primary) : '';
        const lineChanged =
            line !== state.painted.currentLine ||
            (primary?.key ?? '') !== state.painted.currentBlock;
        if (lineChanged) {
            state.renderRevision += 1;
            state.painted.currentLine = line;
            state.painted.currentBlock = primary?.key ?? '';
        }

        let anyInteractive = false;
        for (const block of blocks) {
            const content = planned.get(block.key);
            this.commitBlock(
                block,
                content?.originalText ?? block.originalText,
                content?.translatedText ?? block.translatedText,
                this.interactive && block === primary
            );
            anyInteractive ||= block.interactive;
        }
        if (!anyInteractive) {
            this.words.forget();
        }
        if (lineChanged && this.interactive) {
            this.deps.onOriginalPainted?.(state.renderRevision);
        }
    }

    private commitBlock(
        block: Block,
        originalText: string,
        translatedText: string,
        interactive: boolean
    ): void {
        const paintWords = interactive && originalText !== '';
        if (
            block.originalText !== originalText ||
            block.interactive !== paintWords
        ) {
            if (paintWords) {
                this.words.paint(
                    block.elements.original,
                    originalText,
                    this.deps.state.renderRevision
                );
            } else {
                block.elements.original.textContent = originalText;
            }
            block.originalText = originalText;
            block.interactive = paintWords;
        }
        if (block.translatedText !== translatedText) {
            block.elements.translated.textContent = translatedText;
            block.translatedText = translatedText;
        }
        applySlotVisibility(block.elements);
    }

    private hide(): void {
        const stage = this.container.current;
        if (stage) {
            stage.style.display = 'none';
        }
    }
}
