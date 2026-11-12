// Pause and play straight on the media element, for platforms whose player
// follows its <video> (PlatformCapabilities.directMediaControl).

export function pauseMedia(video: HTMLVideoElement): Promise<boolean> {
    if (!video.paused && !video.ended) {
        video.pause();
    }
    return Promise.resolve(video.paused || video.ended);
}

export async function playMedia(video: HTMLVideoElement): Promise<boolean> {
    if (!video.paused) {
        return true;
    }
    try {
        await video.play();
    } catch {
        return false;
    }
    return !video.paused;
}
