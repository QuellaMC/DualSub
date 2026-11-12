// What both worlds know about YouTube's player elements: Shorts play in
// #shorts-player and everything else in #movie_player, and either id can
// repeat, since Shorts keep a hidden preload player beside the one on
// screen.

export const YOUTUBE_PLAYER_SELECTOR = '#movie_player, #shorts-player';

/** The player's main video, while its picture is on screen. */
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
