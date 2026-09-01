/**
 * Drives render passes from the media clock: requestVideoFrameCallback when
 * available (frame-accurate, self-rescheduling), plus timeupdate as a
 * fallback tick and seeking/seeked to invalidate clock calibration.
 */
export function startFrameLoop(
    video: HTMLVideoElement,
    handlers: { onFrame: () => void; onSeek: () => void },
    signal: AbortSignal
): void {
    if (signal.aborted) {
        return;
    }

    const supportsFrameCallback =
        typeof video.requestVideoFrameCallback === 'function';
    let callbackId: number | null = null;

    const schedule = (): void => {
        if (signal.aborted || !supportsFrameCallback) {
            return;
        }
        callbackId = video.requestVideoFrameCallback(() => {
            callbackId = null;
            if (signal.aborted) {
                return;
            }
            handlers.onFrame();
            schedule();
        });
    };

    video.addEventListener('timeupdate', handlers.onFrame, { signal });
    const seek = (): void => {
        handlers.onSeek();
        handlers.onFrame();
    };
    video.addEventListener('seeking', seek, { signal });
    video.addEventListener('seeked', seek, { signal });
    schedule();

    signal.addEventListener(
        'abort',
        () => {
            if (callbackId !== null && supportsFrameCallback) {
                video.cancelVideoFrameCallback(callbackId);
                callbackId = null;
            }
        },
        { once: true }
    );
}
