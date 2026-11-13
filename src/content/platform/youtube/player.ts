// What both worlds know about YouTube's player elements: Shorts play in
// #shorts-player and everything else in #movie_player, and either id can
// repeat, since Shorts keep a preload player beside the one on screen.

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player, #shorts-player';

/** The player's main video, while it is laid out with a picture. */
export function visibleVideoOf(player: Element): HTMLVideoElement | null {
    const video = player.querySelector<HTMLVideoElement>(
        'video.html5-main-video'
    );
    if (!video) {
        return null;
    }
    const { width, height } = video.getBoundingClientRect();
    return width > 0 && height > 0 ? video : null;
}

/** How much of the video's box lies inside the viewport, in square pixels. */
export function onScreenArea(video: HTMLVideoElement): number {
    const box = video.getBoundingClientRect();
    const width =
        Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
    const height =
        Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return width > 0 && height > 0 ? width * height : 0;
}
