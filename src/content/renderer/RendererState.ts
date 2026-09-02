import type { Cue, CueSet } from '../subtitles/cueModel';
import type { DisplaySettings } from './styling';

export interface FrameMemo {
    readonly evaluatedTime: number;
    readonly nextBoundaryTime: number | null;
    readonly nextBoundaryInclusive: boolean;
    /** Wall-clock deadline for the blank-flash grace, if one is pending. */
    readonly wallClockDeadline: number | null;
    readonly href: string;
    readonly containerEpoch: number;
    readonly video: HTMLVideoElement;
}

export interface PaintedState {
    originalText: string;
    translatedText: string;
    /** The translated slot currently shows the loading placeholder. */
    placeholder: boolean;
    cueWindow: { start: number; end: number } | null;
    styleAppliedAt: number;
}

/**
 * Explicit render state for one session. Every mutation goes through a
 * method that invalidates the frame memo, so the 60 fps loop can skip work
 * without a wide identity comparison.
 */
export class RendererState {
    cues: Cue[] = [];
    useNativeTarget = false;
    /** Subtitles for the current languages are still on their way. */
    loading = false;
    display: DisplaySettings;
    renderRevision = 0;
    frameMemo: FrameMemo | null = null;
    readonly painted: PaintedState = {
        originalText: '',
        translatedText: '',
        placeholder: false,
        cueWindow: null,
        styleAppliedAt: 0,
    };

    constructor(display: DisplaySettings) {
        this.display = display;
    }

    loadCues(cueSet: CueSet): void {
        this.cues = cueSet.cues;
        this.useNativeTarget = cueSet.useNativeTarget;
        this.invalidateMemo();
    }

    applyTranslation(cueId: string, translated: string): void {
        const cue = this.cues.find((candidate) => candidate.id === cueId);
        if (cue) {
            cue.translated = translated;
            this.invalidateMemo();
        }
    }

    setDisplay(display: DisplaySettings): void {
        this.display = display;
        this.invalidateMemo();
    }

    setLoading(loading: boolean): void {
        this.loading = loading;
        this.invalidateMemo();
    }

    invalidateMemo(): void {
        this.frameMemo = null;
    }

    /** True when a frame at `time` could change what is on screen. */
    shouldRender(
        time: number,
        href: string,
        containerEpoch: number,
        video: HTMLVideoElement,
        now: number
    ): boolean {
        const memo = this.frameMemo;
        if (
            !memo ||
            memo.href !== href ||
            memo.containerEpoch !== containerEpoch ||
            memo.video !== video ||
            time < memo.evaluatedTime
        ) {
            return true;
        }
        if (memo.wallClockDeadline !== null && now >= memo.wallClockDeadline) {
            return true;
        }
        if (memo.nextBoundaryTime === null) {
            return false;
        }
        return memo.nextBoundaryInclusive
            ? time >= memo.nextBoundaryTime
            : time > memo.nextBoundaryTime;
    }
}
