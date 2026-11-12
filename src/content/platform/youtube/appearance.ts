import type { SubtitleLook } from '../../renderer/looks';

// YouTube's default caption style as its player draws a caption segment.
// The viewer's own caption settings show nowhere on the page while their
// captions are off, so this preset stands for every viewer.
export const YOUTUBE_LOOK: SubtitleLook = {
    fontFamily:
        '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
    fontWeight: 'normal',
    fontVariant: 'normal',
    originalColor: '#ffffff',
    textShadow: 'none',
    textStroke: '',
    background: 'rgba(8, 8, 8, 0.75)',
    padding: '0 0.25em',
    borderRadius: '0',
};
